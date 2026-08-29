# dsh-subagent-default-model

English | [中文](README.md)

Pick the default model for subagent delegations in [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness), configurable via `~/.dsh/settings.yaml`.

When a subagent is created without an explicit `model`, this plugin injects the configured default — so every `subagent`, `subagent_fork`, and any tool that omits `agentOptions` routes through it. Explicit per-call overrides always win; an absent or incomplete settings section keeps the historical behavior (children inherit the parent route).

## Features

- **Single model** — all subagents run on one configured model.
- **Multi-model** — a `models` list with `round-robin` or `random` strategy spreads parallel subagents across models.
- **Connection-failure failover** — when a subagent hits a connection-class failure, switch to another model in the `models` list by `strategy` and retry (subagents only; the main agent is never touched).
- **Reasoning strength** — optionally specify `reasoningEffort` per model entry (e.g. `high`, `medium`, `low`); the Web UI loads available efforts from the model catalog.
- **Hot-reload** — settings changes apply to the very next delegation.
- **Clean teardown** — Cordis disposal restores the original service methods.

## Screenshots

**Settings panel** (`Settings → Plugins → Plugin configuration → Subagent default model`): configure one or more model routes with `round-robin` / `random` strategy and per-route reasoning effort.

![Subagent default model settings panel](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_01.png)

**Effect verification**: 10 subagents split 5/5 between `deepseek-v4-flash` and `Kimi-k3` (round-robin).

![Subagent default model distribution](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_02.png)

## Marketplace

[![dshfind plugin](https://dshfind.com/api/badge/dingminhua/dsh-subagent-default-model)](https://dshfind.com/plugins/dingminhua/dsh-subagent-default-model)

## Install

Install from the npm registry:

```sh
npm install dsh-subagent-default-model
```

Or via the DSH plugin command (equivalent; it goes through npm internally):

```sh
dsh plugin --profile desktop add dsh-subagent-default-model
```

## Release / Publish

Publish to the npm registry. **The full authoritative flow lives in [`RELEASING.md`](../../RELEASING.md)** (2FA confirmation, tag fix, proxy, verification).

Quick reference:

```sh
# 1. Test: npm --prefix plugin test
# 2. Bump version (plugin/package.json `version`) and update CHANGELOG.md
# 3. Commit and tag
git add plugin/package.json plugin/CHANGELOG.md
git commit -m "chore: bump version to X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <summary>"
git push origin main
git push origin vX.Y.Z

# 4. Publish to npm (if the account has 2FA, confirm in the browser)
cd plugin
npm publish
```

> ⚠️ Run the tests first: `npm --prefix plugin test`.
> The `files` field in `package.json` limits publishing to `lib/`, `icons/`, `cordis.patch.yml`, `LICENSE`, `README.md`, `README.en.md`, `CHANGELOG.md` — `test/` and `node_modules/` are never packed.

Local install (DSH Desktop / desktop profile):

```sh
# Run under ~/.dsh/profiles/desktop (or use the dsh plugin command)
npm install dsh-subagent-default-model
# Or local dev: dsh plugin --profile desktop add /path/plugin (link: install, changes apply immediately)
```

Notes:

- Local dev uses a `link:` install: `dsh plugin --profile desktop add /Users/dmh2002/DshProject/dsh-subagent-default-model/plugin` — `node_modules` holds a source symlink, so **restart DSH Desktop** after changing code.
- Production / other machines use the npm registry version (see Install above).

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
| `failoverEnabled` | boolean | `true` | Switch models by queue and strategy inside the `models` list when a subagent hits a connection failure (subagents only). |
| `reasoningEffort` | string | — | Optional reasoning strength for a model entry (e.g. `high`, `max`). |

## Subagent connection-failure failover

With `failoverEnabled` on (the default), when a subagent's own loop hits a connection-class failure, the plugin automatically switches models inside the `models` list and retries, following `strategy`:

- **Connection-class failures** — the switch triggers only on these error codes: `RATE_LIMIT`, `QUOTA`, `SERVER`, `TIMEOUT`, `TRANSPORT`, `EMPTY_RESPONSE`. Non-connection failures (e.g. `AUTH`) do **not** trigger a switch.
- `round-robin`: advance to the next model in the list (the queue).
- `random`: pick any model (without checking whether it was used before).
- **Needs ≥ 2 models** — with fewer than 2 entries in `models`, the feature is inactive.
- **Exhaustion passes through** — once every pool entry has been tried and failed, the real error is let through; no infinite retries.
- **Inherited `reasoningEffort` is dropped on switch** — the new provider/model is requested at the default reasoning strength instead of forcing the primary's strength onto a provider that may not support it.
- **Sticky within a run** — subsequent steps of the same subagent run stay on the switched model.

It builds on the official `agent/request-error` + `agent/request` waterfalls and applies **only to subagents** — the main agent loop is never switched.

## How it works

```text
Explicit agentOptions on the request
  → subagent-default-model settings
  → inherit parent session route
```

The plugin wraps the host `ctx.subagents` service (`start` / `startContinuable`), so it covers every delegation path — built-in `subagent` / `subagent_fork` tools and any custom tool that calls the service without providing `agentOptions`.

## License

This project is open-sourced under the [MIT License](LICENSE), copyright (c) 2026 LaoDing.

The MIT License grants anyone the freedom to deal in the Software without restriction, including using, copying, modifying, merging, publishing, distributing, sublicensing, and/or selling copies, provided that all copies or substantial portions retain the above copyright notice and this permission notice; the Software is provided "AS IS", without warranty of any kind. See [LICENSE](LICENSE) for the full text.
