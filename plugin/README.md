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
