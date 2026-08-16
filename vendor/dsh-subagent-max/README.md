# @aaravarr/dsh-subagent-max

English | [中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/@aaravarr/dsh-subagent-max.svg?style=flat-square)](https://www.npmjs.com/package/@aaravarr/dsh-subagent-max)
[![license](https://img.shields.io/npm/l/@aaravarr/dsh-subagent-max.svg?style=flat-square)](LICENSE)

> Multi-panel live subagent viewer for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/DeepSeek-Harness), plus a `subagent_with_model` tool for per-call model/provider override.

## Screenshots

**Subagents tab** — a card grid grouped into active / inactive and sorted by last activity.

<img src="docs/subagents-tab.png" alt="Subagents tab" width="720">

**Floating viewer panel** — a draggable panel streaming a subagent's live output: task, reasoning, tool calls, and text.

<img src="docs/viewer-panel.png" alt="Floating viewer" width="720">

A two-face DSH plugin:

- **Host face** (`lib/index.js`) — a Cordis plugin that registers the `subagent_with_model` tool, a thin wrapper over `ctx.subagents` that forwards `model` / `provider` into the child's `agentOptions`.
- **Client face** (`lib/client.js`) — a Web UI that renders every subagent as a draggable, resizable floating panel with live token-by-token output, plus a **Subagents** tab with a card grid.

## Features

- **Per-call model / provider override** — delegate to a subagent and pick its model explicitly.
- **Multi-panel live viewer** — open several subagent panels at once; each streams output in real time.
- **Rich block rendering** — prompt block, reasoning (think) blocks, tool-call cards with input/output, streaming shimmer, markdown.
- **Subagents tab** — card grid grouped into active / inactive and sorted by last activity; shows model, tokens, steps, context % and relative update time.
- **Drag to pop out** — drag a card onto the canvas to open its panel exactly where you drop it (with a ghost preview).
- **Notifications** — side-top toasts when a subagent starts or receives a message.
- **i18n** — zh / en, switchable from DSH settings.

## Install

```sh
dsh plugin --profile web add @aaravarr/dsh-subagent-max
```

or, manually, place the package under `<profile>/node_modules/@aaravarr/dsh-subagent-max/` and add the entry to `cordis.patch.yml` (see [Config](#config)).

## Config

```yaml
- insert:
    - id: dsh-subagent-max
      name: '@aaravarr/dsh-subagent-max'
      config:
        subagentProvider: spawn        # spawn | fork | acp
        toolName: subagent_with_model
        backgroundMode: continuable    # one-shot | continuable
        maxDepth: 3
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `subagentProvider` | string | `spawn` | Subagent transport provider. |
| `toolName` | string | `subagent_with_model` | Model-facing tool name; must be unique among loaded tools. |
| `backgroundMode` | string | `one-shot` | `continuable` returns a durable subagent id; `one-shot` runs foreground. |
| `maxDepth` | number | `3` | Absolute delegation-depth cap for children (`0` forbids further delegation). |

## Usage

Ask the model to delegate with an explicit model:

> 用 `deepseek-v4-flash` 起一个子代理，帮我看看这个仓库的测试覆盖情况。

Tool parameters:

| Arg | Type | Required | Notes |
| --- | --- | --- | --- |
| `model` | string | yes | Child model id (e.g. `deepseek-v4-pro`, `deepseek-v4-flash`, `k3-256k`). |
| `provider` | string | no | LLM provider route; omitted = inherit the parent's provider. |
| `description` | string | yes | Short (3-5 word) task label. |
| `prompt` | string | yes | Complete, self-contained task. |
| `run_in_background` | bool | no | Background routing; default follows `backgroundMode`. |

## Known Limitations

- Model display is derived from the session's `request/header`; it can be absent for some children.
- Last-activity time is tracked client-side and cached in `localStorage`; the first open after a fresh load may fall back to the session's `updatedAt`.
- Client UI targets the web platform only.

## Development

```sh
pnpm install
node --check lib/index.js lib/client.js
```

## License

[MIT](LICENSE)