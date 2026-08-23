# dsh-subagent-default-model

Default model for subagent delegations in [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness), configurable via `~/.dsh/settings.yaml`.

When a subagent is created without an explicit `model`, this plugin injects the configured default — so every `subagent`, `subagent_fork`, and any tool that omits `agentOptions` routes through it. Explicit per-call overrides always win; an absent or incomplete settings section keeps the historical behavior (children inherit the parent route).

## Features

- **Single model** — all subagents run on one configured model.
- **Multi-model** — a `models` list with `round-robin` or `random` strategy spreads parallel subagents across models.
- **Reasoning strength** — optionally specify `reasoningEffort` per model entry (e.g. `high`, `medium`, `low`); the Web UI loads available efforts from the model catalog.
- **Hot-reload** — settings changes apply to the very next delegation.
- **Clean teardown** — Cordis disposal restores the original service methods.

## Install

```sh
dsh plugin --profile web add dsh-subagent-default-model
```

## Release / Publish

> **本插件不发布到 npm**，通过 Git 发布。安装方式为 `file:` 本地依赖，提交代码推送到 GitHub 即可完成发布。

发布流程：

```sh
# 1. 更新版本号（plugin/package.json）和 CHANGELOG.md
# 2. 提交并打标签
git add -A
git commit -m "feat: ..."
git tag v0.3.0
git push origin main --tags

# 3. 同步到本地 web profile 的 file: 依赖
cd ~/.dsh/profiles/web && pnpm install
```

> ⚠️ **Web profile 依赖变动注意（模块双胞胎）**：对 `~/.dsh/profiles/web` 执行 `pnpm install` / `add` / `remove` 后，**必须**先运行
> `bash ~/.dsh/scripts/fix-module-twins.sh`
> 看到末尾「自检通过：全部 SAME」后，重启 dsh web 进程。否则工具调用会全部失败（报 `reading 'prepare'`），且该会话历史会被污染需新开会话。
> 该脚本幂等，重复执行无害。

说明：

- 插件的 web profile 安装方式为 `"dsh-subagent-default-model": "file:/Users/dmh2002/GithubProject/dsh-subagent-default-model/plugin"`（见 `~/.dsh/profiles/web/package.json`）
- 代码修改后，`pnpm install` 会把 `file:` 依赖的最新文件同步到 web profile，然后刷新页面即可生效
- 如需全新安装：`dsh plugin --profile web add dsh-subagent-default-model`

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
