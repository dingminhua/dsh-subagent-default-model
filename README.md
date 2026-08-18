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

将包安装到应使用它的 DSH profile：

```bash
dsh plugin --profile web add /绝对路径/dsh-subagent-default-model/plugin
```

若用 headless profile，把 `web` 换成 `headless`。

该包把 `cordis.patch.yml` 声明为 DSH bundle patch。添加或移除 bundle 后需重启对应的 DSH 进程，以重建 profile 组合。设置文件的编辑是热加载的，无需重启。

## Web 设置

本插件自带 Web 设置行：**设置 → 通用设置 → 子代理默认模型** 由 `plugin/lib/client.js`（浏览器半边）渲染，宿主半边在 `plugin/lib/index.js` 注册 `subagent-default-model` 设置段并包装 `ctx.subagents` 服务。设置行与后端共用同一个 `subagent-default-model` 段，二者不再由两个独立包分别维护。

该行支持：

- 清空选择以继承父会话路由；
- 添加或移除一个或多个 provider/model 路由；
- 保留那些暂时在模型目录中不可用的已存路由；
- 在配置了多个路由时选择 `round-robin` 或 `random`。

它保存的值使用上文所述的同一 `subagent-default-model` 段。它会保留该段中无关的字段，且不会仅仅因为打开过设置面板就弄丢已有的模型列表。

> 历史说明：此设置行最初由本地 fork `vendor/dsh-subagent-max` 提供，其代码（仅 `lib/client.js` 里 `SubagentModelRow` 及配套 locale/CSS，约 380 行）已提取进本插件的 `plugin/lib/client.js`，fork 本身已不再作为依赖加载

### 将设置段暴露给 Web 配置客户端

DSH 的 Host API 代理（`@deepseek-ai/dsh-host-apiproxy`）对 `settings.describe` / `settings.mutate` 做 namespace 白名单过滤：只有「可配置 LLM provider 的 `settingsNs`」加上包内硬编码的 `WEB_SETTINGS_NAMESPACES` / `PRODUCT_SETTINGS_NAMESPACES` 列表里的 namespace 才对 Web 客户端可读写。插件自己 `settings.register()` 的 namespace 默认**不会**被暴露（上游注释明确说明：把该声明移到 `settings.register()` 属于 deferred work）。被过滤的表现是：设置行控件不渲染、保存按钮永久灰色。

因此需要在运行中的 DSH 安装里给 apiproxy 的白名单加一行。找到实际生效的 `dsh-host-apiproxy/lib/index.js`（注意 `~/.dsh/profiles/node_modules/@deepseek-ai/` 下多为指向 npx 缓存的 symlink，改 symlink 目标一处即可全局生效），把：

```js
const WEB_SETTINGS_NAMESPACES = [
	"agent-loop",
	"shell",
	"locale",
	"permission",
	"ui-conversation",
	"ui-theme",
	"web-search-deepseek"
];
```

改为：

```js
const WEB_SETTINGS_NAMESPACES = [
	"agent-loop",
	"shell",
	"locale",
	"permission",
	"ui-conversation",
	"ui-theme",
	"web-search-deepseek",
	"subagent-default-model"
];
```

然后重启 DSH web 进程。可以用下面的调用自检（返回的 `namespaces` 里应出现 `subagent-default-model`）：

```bash
curl -s --noproxy '*' -X POST http://127.0.0.1:3080/api/settings.describe \
  -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"check","method":"settings.describe","payload":{}}'
```

> 注意：升级或重装 DSH 会覆盖该 patch，保存功能会再次失效（现象同上）；按本节重新打 patch 即可恢复。此前尝试过的 `ctx.llm.registerConfigurableProviders` 伪装 provider 方案已废弃——它会污染 Models 页面的 provider 目录，并在部分路径触发 `Cannot read properties of undefined (reading 'prepare')`。

### 设置行的持久化与渲染行为

本插件的设置行（`plugin/lib/client.js`）自带以下行为：

- 当 scope 快照缺失可选的 `writable` 字段时，保存按钮不再被永久禁用——只有显式为 `writable === false` 时才禁用。
- 保存通过公开的 `scope.set()` 接缝按顺序写入 `provider`、`model`、`models`、`strategy`（兼容设置 provider 的 revision/变更队列），随后重读快照并逐字段比对；不一致会报告真实失败，而非假装成功。
- 打开/保存过程中保留该段中无关的字段。
- 行卡片加了一点垂直外边距（`margin: 20px 0`），避免与通用设置里相邻的扁平行贴在一起。

`subagent-model` 行只有一个 owner（本插件自身），不要在其他 bundle 里重复注册同名行，否则设置面板会渲染出重复控件。

### 接线本地 web profile

本地 web profile 只需加载本插件一个 bundle。在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中只列 `dsh-subagent-default-model` 即可（`vendor/dsh-subagent-max` 不再需要）。修改插件源码后，刷新安装副本并重启 web 进程：

```bash
pnpm --dir ~/.dsh/profiles/web add dsh-subagent-default-model@file:/绝对路径/plugin
dsh web
```

硬刷新浏览器（`Cmd/Ctrl + Shift + R`）以加载新的 client bundle。

> 若不再使用 `dsh-codex-connect`，从 `dependencies` 与 `dsh.profile.bundles` 中移除它（`pnpm --dir ~/.dsh/profiles/web remove dsh-codex-connect`），再重启 web 即可关闭。

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

### 安装后若工具调用全部失败（DSH 环境问题，与本插件功能无关）

对 web profile 执行 `pnpm install` / `add` / `remove`（包括安装本插件）可能触发 DSH 的 peer 依赖“模块双胞胎”，任何工具调用 0ms 失败（`Cannot read properties of undefined (reading 'prepare')`）。这是 DSH 安装布局的问题，不是本插件的功能缺陷。

修复脚本与详细说明维护在 DSH 全局目录，不在本仓库：

```bash
bash ~/.dsh/scripts/fix-module-twins.sh   # 每次动过 web profile 依赖后运行，然后重启 web
```

详见 `~/.dsh/AGENTS.md`。

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
dsh plugin --profile web remove dsh-subagent-default-model
```

移除后重启 DSH 进程。`~/.dsh/settings.yaml` 中的 `subagent-default-model` 配置段不会被自动删除，但不再生效；可以手动清理。

## 更新

```bash
dsh plugin --profile web add dsh-subagent-default-model
```

版本号变更时，重新 `add` 会覆盖已有安装。更新后重启 DSH 进程。

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