# 设计：每个模型独立重试 + 逐个切换 + 全部失败才停

> 需求来源（用户原话）：
> "如果重试5次失败了，就要切换模型并且要继续任务，直到设置的模型都试过了，
> 不管是随机还是依次，这个对话里遇到失败，所有设置的模型都试过且都失败过，那就停下来。"

## 1. 需求陈述

对一个 subagent 会话的一次 LLM 请求，当发生连接类失败（429 / 5xx / timeout 等）时：

1. **当前模型先耗尽自己的重试配额**（默认跟随 DSH 官方 `maxRetries = 5`，可配置）。
2. 当前模型配额耗尽仍失败 → **切换到池子里下一个模型，继续同一任务**（同一 turn/step 重新发起请求，上下文不丢）。
3. 下一个模型同样先耗尽自己的重试配额。
4. **池子里所有模型都试过、且全部失败 → 任务停止**（让真实错误浮出，subagent 失败）。
5. 切换顺序：随机或依次（round-robin），由 `strategy` 决定。

一句话：**每个模型都有独立的重试预算；预算用完就换下一个；全都用完才认输。**

## 2. 现状与问题

### 2.1 官方重试（dsh-llm-retry）按 provider 记账，不认模型

`dsh-llm-retry/lib/index.js` 里重试计数器的"钥匙"是：

```js
event.type === "llm/retry" &&
event.data.turn === turn &&
event.data.step === step &&
event.data.provider === provider &&   // ← 只按 provider
event.data.policyKey === policyKey     // ← 策略键不含 model
```

配额判断（`mode === "normal"` 时）：

```js
if (previousRetry >= policy.maxRetries) return next();   // 配额已满 → 不再重试
```

**后果**：在同一个 provider（如 `test`）下把模型从 `deepseek-v4-pro` 切到 `deepseek-v4-flash`，`provider` 没变 → 官方重试计数器仍是 `5/5` → 第二个模型一失败就直接判"配额已满"，**0 次重试**，直接失败。

这正好解释用户观察到的现象：
```
子代理模型：test/deepseek-v4-flash     ← 初始模型
已重试模型请求（5/5）· 8s               ← flash 重试 5 次全失败
已切换到：test/deepseek-v4-pro         ← 插件切一次
本轮运行失败 429                        ← pro 直接失败（没有自己的 5 次重试）
```

### 2.2 本插件当前行为

- `agent/request-error` 监听器：`RATE_LIMIT` 等白名单码 → 返回 `{kind:"retry"}`（驱动 agent-loop 换模型重建请求）。
- 池耗尽判定：`count >= view.entries.length - 1` → 让路（`next()`），真实错误浮出。
- 结果：**每个模型只被"试一次"，没有独立的 5 次重试**。

## 3. 目标行为

| 环节 | 当前 | 目标 |
| --- | --- | --- |
| 每个模型的重试配额 | 官方按 provider 共享 5 次，同 provider 第二个模型 0 次 | **每个模型独立 5 次**（可配置） |
| 切换 | 每个模型只试 1 次就切 | 配额耗尽才切，切后继续任务 |
| 停止条件 | 切 N-1 次后停止 | **所有模型都试过且全部失败才停止** |
| 顺序 | round-robin | round-robin / random 均可 |

## 4. 实现方案

### 4.1 关键钩子：Cordis `ctx.on` 支持 `prepend`

`cordis/lib/index.js`：

```js
const method = options.prepend ? "unshift" : "push";   // prepend → 插到监听队列最前
```

官方 `dsh-llm-retry` 和本插件都监听 `agent/request-error`。默认本插件在其后；用
`{ prepend: true }` 注册可以让本插件**先于官方**决定"重试 / 切换 / 放弃"。

### 4.2 方案 A（推荐）：插件接管"每模型重试 + 切换 + 池耗尽停止"

- 用 `ctx.on("agent/request-error", handler, { prepend: true })` 在官方之前注册。
- 插件自己按 `(agent.id, turn, step, model)` 记账**每个模型的失败次数**。
- 每次收到失败：
  1. 非白名单码 / 非 subagent / 已 aborted → `next()` 让路。
  2. 当前模型失败次数 < 每模型配额（默认 5）→ 记录 +1 → 返回 `{kind:"retry"}`（**同一模型重试**）。
  3. 当前模型配额耗尽 → 切到下一个（round-robin / random），重置该模型计数 → 返回 `{kind:"retry"}`（**换模型继续任务**）。
  4. 池子里所有模型都试过且配额都耗尽 → `next()`（让真实错误浮出，任务失败停止）。
- 因为 `prepend` 短路，官方 `dsh-llm-retry` 不再拦截子代理的重试（由插件完全接管，更可控）。

**优点**：不改宿主、语义精确（每个模型独立预算、全部失败才停）。
**风险**：接管后官方重试对子代理不再生效，需要回归测试确认主代理不受影响（插件只 hook subagent）。

### 4.3 方案 B：不改代码，靠"每模型一个 provider"（✅ 已实测通过）

官方重试按 `provider` 记账 → 把池子里每个模型配成**不同的 provider**（如 `test-a` / `test-b`），天然每模型独立 5 次重试。

**优点**：零代码改动。
**缺点**：要改配置；同 provider 下多个模型仍然共享配额；与"策略=random/round-robin 跨 provider"的既有逻辑需验证。

**实测结论（MOCK_ALL_FAIL=1，全失败模式，两个模型分属 `test` 与 `test2` 两个 provider）**：

| 配置 | 第二个模型的表现在 |
| --- | --- |
| 同一 provider 下两个模型 | 切到第二个模型后 **0.09s 直接失败**，无重试（共享 5 次配额被第一个模型耗尽） |
| **两个 provider 各带一个模型** | 切到第二个模型后 **15.5s 才结束**，即第二个模型也完整重试 5 次（指数退避 1s→2s→4s→8s），池耗尽后才失败 |

结论：**方案 B 有效达成"每个模型独立重试、全部失败才停"**，无需改代码。

### 4.4 结论

- **推荐方案 B**（已实测）：把池子里每个模型配成**独立 provider**，零代码改动即达目标语义。
- 方案 A 作为后续升级：当用户希望**同一个 provider 下多个模型也各自独立重试**（不想拆 provider）时，再用插件 `prepend` 接管每模型重试计数。

## 5. 验证方法

用现有 mock（`plugin/scripts/mock-llm-server.mjs`）：

1. **全部失败**（`MOCK_ALL_FAIL=1`，两个模型都 429）：
   预期：flash 重试 5/5 → 已切换到 pro → pro 也重试 5/5 → 池耗尽 → 任务失败。
   旧行为是"pro 直接失败"，新行为应为"pro 也重试 5 次"。
2. **一好一坏**（默认，pro 429 / flash 200）：
   预期：flash 重试 5/5 → 已切换到 pro → pro 第 1 次就成功 → 任务完成。
3. **三个模型 / 随机策略**：验证任意顺序、全失败停止。

## 6. 相关代码位置

- 插件 failover 安装：`plugin/lib/index.js`（`agent/request-error` ~186 行、`agent/request` ~221 行、池耗尽 ~197 行）。
- 官方重试记账：`dsh-llm-retry/lib/index.js`（`recover` ~129 行、计数器 ~140 行）。
- Cordis 监听排序：`cordis/lib/index.js`（`register` ~335 行、`prepend` ~336 行）。
