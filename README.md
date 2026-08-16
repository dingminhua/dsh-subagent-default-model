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

宿主插件刻意不注册第二个 Web 设置行。**设置 → 通用设置 → 子代理默认模型** 这一行由本地维护的 fork（`vendor/dsh-subagent-max`）提供。

该行支持：

- 清空选择以继承父会话路由；
- 添加或移除一个或多个 provider/model 路由；
- 保留那些暂时在模型目录中不可用的已存路由；
- 在配置了多个路由时选择 `round-robin` 或 `random`。

它保存的值使用上文所述的同一 `subagent-default-model` 段。它会保留该段中无关的字段，且不会仅仅因为打开过设置面板就弄丢已有的模型列表。

### 将设置段暴露给 Web 配置客户端

DSH 的 Host API 代理只服务「可配置 LLM provider」或它自身硬编码白名单里的设置 namespace。为了让 `subagent-default-model` 能被 Web 设置行读写，宿主插件还通过 `ctx.llm.registerConfigurableProviders` 把它注册为 **dormant（休眠）可配置 provider**（`declared: false`）。因为是休眠条目，它不会出现在活跃模型目录或模型选择里——它只是扩大了暴露的 namespace 集合，使 `settings.describe` / `settings.mutate` 能服务该段并持久化到 `~/.dsh/settings.yaml`。

### fork 对设置行的修复

`vendor/dsh-subagent-max` fork 携带了该行的持久化与渲染修复：

- 当 scope 快照缺失可选的 `writable` 字段时，保存按钮不再被永久禁用——只有显式为 `writable === false` 时才禁用。
- 保存通过公开的 `scope.set()` 接缝按顺序写入 `provider`、`model`、`models`、`strategy`（兼容设置 provider 的 revision/变更队列），随后重读快照并逐字段比对；不一致会报告真实失败，而非假装成功。
- 打开/保存过程中保留该段中无关的字段。
- 行卡片加了一点垂直外边距（`margin: 8px 0`），避免与通用设置里相邻的扁平行贴在一起。

### 接线本地 web profile

本地 web profile 必须同时加载**后端 bundle** 与 fork（`subagent-model` 行只能有一个 owner——绝不能有两个 owner，否则设置面板会渲染出重复控件）。在 `~/.dsh/profiles/web/package.json` 中：

```json
"dependencies": {
  "@aaravarr/dsh-subagent-max": "file:/绝对路径/dsh-subagent-default-model/vendor/dsh-subagent-max",
  "dsh-subagent-default-model": "file:/绝对路径/dsh-subagent-default-model/plugin"
}
```

并且 `dsh.profile.bundles` 里列出 `@aaravarr/dsh-subagent-max` 与 `dsh-subagent-default-model`。修改插件或 fork 源码后，刷新安装副本并重启 web 进程：

```bash
pnpm --dir ~/.dsh/profiles/web add @aaravarr/dsh-subagent-max@file:/绝对路径/vendor/dsh-subagent-max
pnpm --dir ~/.dsh/profiles/web add dsh-subagent-default-model@file:/绝对路径/plugin
dsh web
```

硬刷新浏览器（`Cmd/Ctrl + Shift + R`）以加载新的 client bundle。

> 若不再使用 `dsh-codex-connect`，从上述 `dependencies` 与 `dsh.profile.bundles` 中移除它（`pnpm --dir ~/.dsh/profiles/web remove dsh-codex-connect`），再重启 web 即可关闭。

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

## 端到端验证

0. 在 Web UI 中验证设置行确实落盘：打开 **设置 → 通用设置 → 子代理默认模型**，改动一个路由或策略，保存，确认 `~/.dsh/settings.yaml` 中的 `subagent-default-model` 与之一致，然后关闭并重新打开面板，确认选择被保留。这个「保存 → YAML 更新 → 重开仍保留」的流程已在运行中的 DSH web 进程上实测通过。

1. 把 bundle 装进一个一次性 profile，并配置一个已知模型或包含两个模型的 `round-robin` 列表。
2. 重启对应的 DSH 进程。
3. 创建多个未显式选择模型的子代理。
4. 检查每个子代理会话的 `request/header.config.model`：

   ```text
   ~/.dsh/sessions/<workspace>/<child-id>/session.jsonl.zstd
   ```

   一个形如 `pro, flash` 的 round-robin 列表，对连续的子代理请求应产生 `pro → flash → pro`。带显式 `agentOptions` 创建的子代理应保留其显式模型。