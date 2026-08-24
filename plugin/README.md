# dsh-subagent-default-model

Default model for subagent delegations in [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness), configurable via `~/.dsh/settings.yaml`.

When a subagent is created without an explicit `model`, this plugin injects the configured default — so every `subagent`, `subagent_fork`, and any tool that omits `agentOptions` routes through it. Explicit per-call overrides always win; an absent or incomplete settings section keeps the historical behavior (children inherit the parent route).

## Features

- **Single model** — all subagents run on one configured model.
- **Multi-model** — a `models` list with `round-robin` or `random` strategy spreads parallel subagents across models.
- **Reasoning strength** — optionally specify `reasoningEffort` per model entry (e.g. `high`, `medium`, `low`); the Web UI loads available efforts from the model catalog.
- **Hot-reload** — settings changes apply to the very next delegation.
- **Clean teardown** — Cordis disposal restores the original service methods.

## Screenshots

**Settings panel** (`Settings → General → Subagent default model`): configure one or more model routes with `round-robin` / `random` strategy and per-route reasoning effort.

![Subagent default model settings panel](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_01.png)

**Effect verification**: 10 subagents split 5/5 between `deepseek-v4-flash` and `Kimi-k3` (round-robin).

![Subagent default model distribution](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_02.png)

## Marketplace

[![dshfind plugin](https://dshfind.com/api/badge/dingminhua/dsh-subagent-default-model)](https://dshfind.com/plugins/dingminhua/dsh-subagent-default-model)

## Install

从 npm registry 安装：

```sh
npm install dsh-subagent-default-model
```

或通过 DSH 插件命令（等价，内部同样走 npm）：

```sh
dsh plugin --profile desktop add dsh-subagent-default-model
```

## Release / Publish

发布到 npm registry：

```sh
# 1. 更新版本号（plugin/package.json 的 version 字段）和 CHANGELOG.md
# 2. 提交并打标签
git add -A
git commit -m "feat: ..."
git tag v0.3.1
git push origin main --tags

# 3. 发布到 npm
cd plugin
npm login        # 首次发布前登录一次
npm publish
```

> ⚠️ 发布前先跑一遍测试：`npm --prefix plugin test`。
> `package.json` 的 `files` 字段已限定只发布 `lib/`、`cordis.patch.yml`、`LICENSE`、`README.md`、`CHANGELOG.md`，`test/` 和 `node_modules/` 不会进入发布包。

本地安装（DSH Desktop / desktop profile）：

```sh
# 在 ~/.dsh/profiles/desktop 下执行（或使用 dsh plugin 命令）
npm install dsh-subagent-default-model
# 或本地开发：dsh plugin --profile desktop add /路径/plugin（link: 安装，改码即时生效）
```

说明：

- 本地开发用 `link:` 安装：`dsh plugin --profile desktop add /Users/dmh2002/DshProject/dsh-subagent-default-model/plugin`，node_modules 里是源码软链，改代码后**重启 DSH Desktop** 生效
- 正式安装 / 他机安装使用 npm registry 版本（见上方 Install）

## Configuration

Add to `~/.dsh/settings.yaml`:

```yaml
# Single model
subagent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro

# Or multiple models
subagent-default-model:
  provider: deepseek-official
  models:
    - deepseek-v4-pro
    - deepseek-v4-flash
  strategy: round-robin  # round-robin | random

# With reasoning strength
subagent-default-model:
  provider: deepseek-official
  models:
    - model: deepseek-v4-reasoner
      reasoningEffort: high
    - provider: other-provider
      model: gpt-5.6
      reasoningEffort: max
  strategy: round-robin  # round-robin | random
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `provider` | string | — | Provider for string-type model entries. |
| `model` | string | — | Single model id (backward compatible). |
| `models` | array | `[]` | List of model entries (string or `{provider, model, reasoningEffort?}` pair). |
| `strategy` | string | `round-robin` | Selection strategy: `round-robin` or `random`. |
| `reasoningEffort` | string | — | Optional reasoning strength for a model entry (e.g. `high`, `max`). |

## How it works

```text
Explicit agentOptions on the request
  → subagent-default-model settings
  → inherit parent session route
```

The plugin wraps the host `ctx.subagents` service (`start` / `startContinuable`), so it covers every delegation path — built-in `subagent` / `subagent_fork` tools and any custom tool that calls the service without providing `agentOptions`.

## License

[MIT](LICENSE)
