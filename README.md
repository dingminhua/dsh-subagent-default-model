# dsh-subagent-default-model

一个独立的 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle 插件，通过 `~/.dsh/settings.yaml` 为子代理（child-agent）派发选择默认模型。

它只改动省略了 `agentOptions` 的子代理请求；DSH 核心包保持原样，不做任何修改。

## 行为

插件注册 `subagent-default-model` 设置段，并在其 fiber 存活期间包装宿主 `ctx.subagents` 服务。

模型优先级：

```text
显式请求 agentOptions
  → subagent-default-model 设置
  → 继承父会话路由
```

包装同时作用于 `start()` 与 `startContinuable()`，覆盖内置的 `subagent` / `subagent_fork` 路径，以及其他调用该服务的发起方。

- 显式提供的 `agentOptions` 对象永不改动。
- 配置缺失或不完整时不注入任何内容，子代理继承父会话路由。
- 非空的 `models` 列表优先于单 `model` 形式。
- 设置读取是实时的：编辑 `settings.yaml` 会立即影响下一次派发。
- Cordis 销毁本插件时会还原服务包装，因此后续重新挂载会干净启动。

## 截图

**设置面板**（`设置 → 通用设置 → 子代理默认模型`）：配置一个或多个模型路由，支持 `round-robin` / `random` 分配策略与每路由推理强度。

![子代理默认模型设置面板](assets/pic_01.png)

**效果验证**：10 个子代理在 `deepseek-v4-flash` 与 `Kimi-k3` 之间 5/5 均衡分配（round-robin 实测）。

![子代理默认模型分配统计](assets/pic_02.png)

## 配置

在 `~/.dsh/settings.yaml` 中添加以下任一形式。

### 固定单个子代理模型

```yaml
subagent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro
```

### 多个子代理模型

```yaml
subagent-default-model:
  provider: deepseek-official # 字符串条目的默认 provider
  models:
    - deepseek-v4-pro
    - deepseek-v4-flash
    # 显式跨 provider 条目：
    # - provider: kimi
    #   model: kimi-k3
  strategy: round-robin # round-robin（默认）或 random
```

`round-robin` 按顺序轮流选取有效条目；`random` 对每次派发独立随机选取。无效或不完整的条目会被忽略；若没有剩余的有效条目，子代理继承父会话路由。

## 安装

将包安装到应使用它的 DSH profile（当前环境为 DSH Desktop，使用 `desktop` profile）：

```bash
dsh plugin --profile desktop add /绝对路径/dsh-subagent-default-model/plugin
```

该命令以 `link:` 方式把插件装入 `~/.dsh/profiles/desktop`（`dependencies` + `dsh.profile.bundles` 自动 reconcile）。若用 headless profile，把 `desktop` 换成 `headless`。

该包把 `cordis.patch.yml` 声明为 DSH bundle patch。添加或移除 bundle 后需**重启 DSH Desktop 进程**，以重建 profile 组合。设置文件的编辑是热加载的，无需重启。

## Web 设置

本插件自带 Web 设置行：**设置 → 通用设置 → 子代理默认模型** 由 `plugin/lib/client.js`（浏览器半边）渲染，宿主半边在 `plugin/lib/index.js` 注册 `subagent-default-model` 设置段并包装 `ctx.subagents` 服务。设置行与后端共用同一个 `subagent-default-model` 段，二者不再由两个独立包分别维护。

该行支持：

- 清空选择以继承父会话路由；
- 添加或移除一个或多个 provider/model 路由；
- 保留那些暂时在模型目录中不可用的已存路由；
- 在配置了多个路由时选择 `round-robin` 或 `random`。

它保存的值使用上文所述的同一 `subagent-default-model` 段。它会保留该段中无关的字段，且不会仅仅因为打开过设置面板就弄丢已有的模型列表。

> 历史说明：此设置行最初由本地 fork `vendor/dsh-subagent-max` 提供，其代码（仅 `lib/client.js` 里 `SubagentModelRow` 及配套 locale/CSS，约 380 行）已提取进本插件的 `plugin/lib/client.js`，fork 本身已不再作为依赖加载

### 将设置段暴露给 Web 配置客户端（当前版本已无需 patch）

> **历史说明**：旧版 DSH（0.1.0-rc.6 时代）的 Host API 代理（`@deepseek-ai/dsh-host-apiproxy`）对 `settings.describe` / `settings.mutate` 做 `WEB_SETTINGS_NAMESPACES` 白名单过滤，插件自己 `settings.register()` 的 namespace 默认不会被暴露，需要手动修改 apiproxy 源码添加 namespace。该机制在 DSH **0.1.1-rc.2 已移除**：`settings.describe` 直接返回全部已注册 namespace（`settings.describe({ redactSecrets: true }).map(namespaceView)`），**无需任何 patch**。若未来版本重新引入白名单，再按上述方式处理。

### 设置行的持久化与渲染行为

本插件的设置行（`plugin/lib/client.js`）自带以下行为：

- 当 scope 快照缺失可选的 `writable` 字段时，保存按钮不再被永久禁用——只有显式为 `writable === false` 时才禁用。
- 保存通过公开的 `scope.set()` 接缝按顺序写入 `provider`、`model`、`models`、`strategy`（兼容设置 provider 的 revision/变更队列），随后重读快照并逐字段比对；不一致会报告真实失败，而非假装成功。
- 打开/保存过程中保留该段中无关的字段。
- 行卡片加了一点垂直外边距（`margin: 20px 0`），避免与通用设置里相邻的扁平行贴在一起。

`subagent-model` 行只有一个 owner（本插件自身），不要在其他 bundle 里重复注册同名行，否则设置面板会渲染出重复控件。

### 接线本地 desktop profile

本地 desktop profile 只需加载本插件一个 bundle。在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中只列 `dsh-subagent-default-model` 即可（`vendor/dsh-subagent-max` 不再需要）。推荐用 `dsh plugin` 命令以 `link:` 方式安装（自动 reconcile）：

```bash
dsh plugin --profile desktop add /绝对路径/dsh-subagent-default-model/plugin
```

修改插件源码后（`link:` 软链即时同步），**重启 DSH Desktop** 使 bundle 层重新组合；浏览器硬刷新（`Cmd/Ctrl + Shift + R`）以加载新的 client bundle。

### 让 DSH 发现本插件的 Web 设置行（两个必填点）

DSH 的 `dsh-client-modules` 在启动时扫描加载器里所有声明了 `dsh.client` 的 bundle，并对每个包调用 `require.resolve("<pkg>/package.json")` 定位其 `package.json`。以下两点任一缺失都会导致设置行加载失败（表现为 404 或启动报 `failed to apply loader entry ... cannot get property "connection" without inject`）：

1. **`package.json` 的 `exports` 必须暴露 `./package.json` 子路径**——否则 `dsh-client-modules` 解析包位置失败，整条 client 扫描跳过本插件：

   ```json
   "exports": {
     ".": "./lib/index.js",
     "./client": "./lib/client.js",
     "./cordis.patch.yml": "./cordis.patch.yml",
     "./package.json": "./package.json"
   }
   ```

2. **`plugin/lib/client.js` 的 `inject` 数组必须包含 `connection` 与 `slots`**——设置行在 `apply(ctx)` 里用到 `ctx.connection.api`（拉模型目录）和 `ctx.slots.inject`（注册设置行），二者缺一不可：

   ```js
   var inject = ["sessions", "connection", "slots", "locale", "settingsScope", "remote"];
   ```

   只写 `["settingsScope", "locale", "remote"]` 会在激活时崩溃，报 `cannot get property "connection" without inject`。

`package.json` 还需声明 `dsh.client` 段，DSH 才会把它当作双脸包扫描浏览器半边：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-primitives"] }
}
```

### 安装后若工具调用全部失败（历史问题，`link:` 安装已规避）

> **历史说明**：对旧 `web` profile 执行 `pnpm install` / `add` / `remove` 可能触发 DSH 的 peer 依赖"模块双胞胎"（同一包被装成两份物理副本，模块级 `Symbol()` 钥匙互不相认），表现为任何工具调用 0ms 失败（`Cannot read properties of undefined (reading 'prepare')`）。旧 `dev-web.sh` + `web` profile 工作流已废弃删除；当前 `dsh plugin --profile desktop add` 以 `link:` 安装**不重装依赖树**，不会触发该问题。

## 开发与测试

插件包自带测试依赖与测试命令：

```bash
npm --prefix plugin install
npm --prefix plugin test
```

测试使用真实的 Cordis 上下文和设置 provider，配一个假的 `subagents` 服务。它们覆盖：

- 固定与多模型选择；
- round-robin 轮换与实时设置更新；
- 显式每次调用覆盖与回退行为；
- 普通与可继续（continuable）子代理请求；
- Cordis 销毁时精确还原原始服务方法；
- 当 Cordis 返回 traceable proxy 时所需的稳定原始服务身份。

根目录的兼容命令运行同一套测试的聚焦部分：

```bash
node integration.mjs # 派发与生命周期集成测试
node prove.mjs       # Cordis traceable-proxy 回归测试
```

## 卸载

```bash
dsh plugin --profile desktop remove dsh-subagent-default-model
```

移除后重启 DSH Desktop 进程。`~/.dsh/settings.yaml` 中的 `subagent-default-model` 配置段不会被自动删除，但不再生效；可以手动清理。

## 更新

```bash
dsh plugin --profile desktop add dsh-subagent-default-model
```

版本号变更时，重新 `add` 会覆盖已有安装。更新后重启 DSH Desktop 进程。

## 常见问题

### 保存按钮灰色无法点击

设置行的保存按钮要求「Provider 和 Model 都已选择」。如果有任何一条路由缺少其中一项，按钮保持禁用。填全后即可保存。

### 保存后设置不生效

1. 确认已重启 DSH 进程（bundle 层的加载需要重启）。
2. 设置文件本身的编辑是热加载的，但 bundle 层只有首次启动时组合——所以修改 `settings.yaml` 里的模型列表后无需重启，但**安装或卸载插件**后必须重启。

### 子代理仍然使用父会话模型

检查 `~/.dsh/settings.yaml` 中 `subagent-default-model` 段是否完整：

```yaml
subagent-default-model:
  provider: deepseek-official  # 必须填写
  model: deepseek-v4-pro       # 至少填写 model，或使用 models 列表
```

如果 `provider` 为空或缺失，插件会跳过注入，子代理回退到继承父会话路由。

### 如何让不同子代理使用不同模型？

配置 `models` 列表并设置 `strategy`：

```yaml
subagent-default-model:
  provider: deepseek-official
  models:
    - deepseek-v4-pro
    - deepseek-v4-flash
  strategy: round-robin  # round-robin 或 random
```

连续创建的子代理会按轮换或随机方式分配到不同模型。

### 显式指定了 model 的子代理会被影响吗？

不会。任何在创建子代理时显式传递了 `agentOptions` 的请求，插件完全不触碰——只有省略了 `agentOptions` 的请求才会使用默认模型。

## 端到端验证

0. 在 Web UI 中验证设置行确实落盘：打开 **设置 → 通用设置 → 子代理默认模型**，改动一个路由或策略，保存，确认 `~/.dsh/settings.yaml` 中的 `subagent-default-model` 与之一致，然后关闭并重新打开面板，确认选择被保留。这个「保存 → YAML 更新 → 重开仍保留」的流程已在运行中的 DSH web 进程上实测通过。多模型轮换也已实测：配置 `[deepseek-v4-flash, aixforge/glm-5.2]` + `round-robin` 后，连续 3 个子代理实际路由为 `flash → glm-5.2 → flash`，与配置严格一致。

> **故障排查：`An assistant message with 'tool_calls' must be followed by tool messages ...`**
>
> 这不是配置问题。任何一次工具执行中途崩溃（如上文的双胞胎 bug）、强杀进程或重启 DSH，都可能让该会话日志里留下「已发出的 tool/call 但没有对应的 tool/result」。此后在该会话里每次发消息，运行时都会把这段残缺历史重放给 LLM，API 直接拒绝，且重试永远报同样的错。
>
> 处理：**直接新开会话**，旧会话历史已无法修复。若想确认，可解压 `~/.dsh/sessions/<workspace>/<session>/session.jsonl.zstd`，对比 `tool/call` 与 `tool/result` 事件的 `callId` 是否一一配对。

1. 把 bundle 装进一个一次性 profile，并配置一个已知模型或包含两个模型的 `round-robin` 列表。
2. 重启对应的 DSH 进程。
3. 创建多个未显式选择模型的子代理。
4. 检查每个子代理会话的 `request/header.config.model`：

   ```text
   ~/.dsh/sessions/<workspace>/<child-id>/session.jsonl.zstd
   ```

   一个形如 `pro, flash` 的 round-robin 列表，对连续的子代理请求应产生 `pro → flash → pro`。带显式 `agentOptions` 创建的子代理应保留其显式模型。