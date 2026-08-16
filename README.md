# dsh-subagent-default-model

让 DeepSeek Harness（DSH）子代理默认模型可通过 settings 配置的**独立插件**：
`~/.dsh/settings.yaml` 里的 `subagent-default-model` 分节决定所有未显式指定模型的
子代理（`subagent` / `subagent_fork` 等）用什么模型。

## 插件方式（当前方案 ✅）

`plugin/` 目录是一个标准的 DSH bundle 插件包：

```
plugin/
├── package.json          # name: dsh-subagent-default-model, 声明 dsh.bundle.patch
├── cordis.patch.yml      # insert 插件行（host 平面）
└── lib/index.js          # 注册 settings 分节 + 包装 ctx.subagents 服务
```

**工作原理**（零核心包修改）：

1. `installSettingsSection` 注册 `subagent-default-model` settings 分节
   （host 平面，无 agent 平面时序问题）；
2. 包装宿主 `ctx.subagents` 服务的 `start` / `startContinuable`：
   任何 delegation request 未携带显式 `agentOptions` 时，从 settings 分节读取
   默认模型注入 `request.agentOptions`；
3. 显式指定（如 `subagent_with_model` 传入 model）永远优先；分节缺失/不完整时
   保持历史行为——子代理继承父会话路由。

因为包装在**服务层**而非工具层，stock 的 `subagent` / `subagent_fork` 工具
（以及任何走 `ctx.subagents` 的委托路径）都自动遵守配置，**不需要改
`@deepseek-ai/dsh-tool-subagent` 源码**。

## 配置

`~/.dsh/settings.yaml`。支持**单模型**、**多模型轮换/随机**两种形态：

```yaml
# 形态一：单模型（简单）
subagent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro

# 形态二：多模型（批量派发时分散到不同模型）
subagent-default-model:
  provider: deepseek-official        # 字符串模型项默认使用的 provider
  models:
    - deepseek-v4-pro
    - deepseek-v4-flash
    # 每项也可以显式带 provider（跨提供方混用）：
    # - provider: deepseek-official
    #   model: deepseek-v4-pro
    # - provider: kimi
    #   model: kimi-k3
  strategy: round-robin              # round-robin（依次，默认）| random（随机）
```

选择语义：
- `models` 列表非空 → 按 `strategy` 每次 pick 一个（round-robin 用模块级游标依次轮换；
  random 每次随机）；
- 否则 `model` 单值 → 固定用该模型（向后兼容）；
- 都缺失 → 子代理继承父会话路由。
- 显式 `agentOptions`（如 `subagent_with_model`）永远优先于本配置。

**每次派生子代理都会重新读取配置**（`settingsSource()` 实时取值 + 热重载），
改配置即时生效，无需重启；`strategy` / 模型列表可随时热切换。

## 验证结果（2026-08-16，headless 新进程 + 核心包原始 rc.6）

| 条件 | 连续子代理的 request/header model | 结果 |
|---|---|---|
| 无分节 | `deepseek-v4-flash`（全部） | 继承父路由 ✅ |
| 单模型 `model: deepseek-v4-pro` | `deepseek-v4-pro`（全部） | 固定默认 ✅ |
| 多模型 + `strategy: round-robin` | `pro → flash → pro` | 依次轮换 ✅ |
| 多模型 + `strategy: random` | `pro → flash → flash → pro` | 随机分散 ✅ |
| `subagent_with_model(model: "deepseek-v4-pro")`（显式） | `deepseek-v4-pro` | 显式覆盖优先 ✅ |

验证方法：headless 任务派生子代理，读子会话
`~/.dsh/sessions/<workspace>/<child-id>/session.jsonl.zstd` 的 `request/header.config.model`。

## 安装

### 方式 A：本地开发（当前已用）

插件源码放在本仓库，通过共享模块层 symlink 接入两个 profile：

```bash
ln -sfn /Users/dmh2002/GithubProject/dsh-subagent-default-model/plugin \
        ~/.dsh/profiles/node_modules/dsh-subagent-default-model
# 插件自身依赖解析（schemastery / dsh-settings 指向 npx 缓存）：
# plugin/node_modules/@deepseek-ai/{schemastery,dsh-settings} -> npx 缓存
```

profile bundles 追加插件名（已配置）：
- `~/.dsh/profiles/web/package.json` → `dsh.profile.bundles` 含 `dsh-subagent-default-model`
- `~/.dsh/profiles/headless/package.json`（验证用）同样追加

**重启 `dsh web` 后生效。**

### 方式 B：正式安装（推荐长期使用）

```bash
dsh plugin --profile web add /Users/dmh2002/GithubProject/dsh-subagent-default-model/plugin
```

（`dsh plugin` 转发 pnpm，会把插件作为 file: 依赖写入 web profile 并链接依赖。）

## 配置

`~/.dsh/settings.yaml`：

```yaml
subagent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro
```

settings 分节热重载（chokidar 监听，debounce 100ms），改完即生效。

## 验证结果（2026-08-16，headless 新进程 + 核心包已还原为原始 rc.6）

| 条件 | 子会话 request/header model | 结果 |
|---|---|---|
| 无分节 | `deepseek-v4-flash` | 继承父路由 ✅ |
| `subagent-default-model: deepseek-v4-pro` | `deepseek-v4-pro` | 插件注入生效 ✅ |
| `subagent_with_model(model: "deepseek-v4-pro")`（显式） | `deepseek-v4-pro` | 显式覆盖优先 ✅ |

验证方法：headless 任务派生子代理，读子会话
`~/.dsh/sessions/<workspace>/<child-id>/session.jsonl.zstd` 的 `request/header.config.model`。

## 演进历史（为什么会有这个插件）

1. **06:04 手工补丁**：此前通过直接改 npx 缓存里的
   `@deepseek-ai/dsh-tool-subagent/lib/index.js` 实现过同功能，但补丁有两个 bug：
   - **WeakMap 键不稳定**：`ctx.get("settings")` 每次返回全新的 cordis traceable
     Proxy，作为 WeakMap 键 apply 与 execute 对不上；
   - **注册时序**：agent 平面 apply 时 settings provider 可能仍在加载
     （fiber state 1），同步 `ctx.get("settings")` 返回 undefined，注册被跳过且不重试。
   - 且改核心包文件会被 `@deepseek-ai/dsh` 升级覆盖。
2. **补丁修复验证**：曾修好并验证生效（见 git 历史/早期 README），但方式脆弱。
3. **插件化（当前）**：把功能重写为独立插件，服务层包装，不改核心包；
   核心包已还原为 npm 原始 rc.6（`diff` 与 tarball 完全一致）。

## 附：验证脚本

- `prove.mjs` — 用真实 cordis 复现补丁的 traceable Proxy 键不稳定问题
- `integration.mjs` — 加载真实 `dsh-tool-subagent` 模块 + `dsh-settings` 的集成测试
- `plugin/` — 本插件的完整源码

## 时间线

- 08-15 16:59 — 安装 `@deepseek-ai/dsh@0.1.0-rc.6`（npx 缓存 `6c7f445d1bf61956`）
- 08-16 06:04 — 手工补丁 `dsh-tool-subagent`（含两个 bug）
- 08-16 13:22~13:50 — 验证补丁 bug、定位根因、修复、headless + GUI 重启后验证生效
- 08-16 13:54~14:00 — 插件化：`plugin/` 独立包；核心包还原原始 rc.6；
  headless A/B 验证（有分节 → pro；无分节 → flash）；web profile bundles 接入
- 08-16 14:0x — 用户重启 `dsh web`；GUI 直接派生子代理验证：原始 rc.6 核心包 +
  插件 + `subagent-default-model: deepseek-v4-pro` → 子代理 header 记录 `deepseek-v4-pro` ✅
- 08-16 14:2x — 插件扩展多模型：`models` 列表 + `strategy: round-robin | random`；
  headless 验证轮换（pro→flash→pro）与随机（pro→flash→flash→pro）均生效；
  当前配置为多模型 round-robin
