<p align="center">
  <img src="assets/pic_01.png" width="860" alt="dsh-subagent-default-model settings panel" />
</p>

<h1 align="center">dsh-subagent-default-model</h1>

<p align="center"><b>Pick a default model for DeepSeek Harness subagents, with multi-model rotation.</b></p>

<p align="center">
  <a href="README.md">中文</a> ·
  <a href="#install">Install</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="plugin/CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/dingminhua/dsh-subagent-default-model/issues">Issues</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-subagent-default-model"><img src="https://img.shields.io/npm/v/dsh-subagent-default-model?style=flat-square&label=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dsh-subagent-default-model"><img src="https://img.shields.io/npm/d18m/dsh-subagent-default-model?style=flat-square&label=downloads&color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/dingminhua/dsh-subagent-default-model/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/dingminhua/dsh-subagent-default-model/ci.yml?branch=main&style=flat-square&label=tests" alt="test status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/dingminhua/dsh-subagent-default-model?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/dingminhua/dsh-subagent-default-model/stargazers"><img src="https://img.shields.io/github/stars/dingminhua/dsh-subagent-default-model?style=flat-square" alt="GitHub stars"></a>
  <a href="https://dshfind.com/plugins/dingminhua/dsh-subagent-default-model"><img src="https://dshfind.com/api/badge/dingminhua/dsh-subagent-default-model" alt="dshfind plugin"></a>
</p>

A standalone [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle plugin. It only handles subagent requests that omit `agentOptions`; explicitly specified models always win, and DSH core packages stay untouched.

## Features

- **Single-model default route**: all subagents without an explicit model use one configured route.
- **Multi-model scheduling**: distribute across provider/model routes with `round-robin` or `random`.
- **Connection-failure failover**: when a subagent request hits rate-limit/quota/server errors, it automatically switches to another model in the `models` list by queue or at random and retries; the main agent loop is never affected.
- **Per-route reasoning effort**: each model entry can set its own `reasoningEffort`.
- **Full dispatch coverage**: wraps both `start()` and `startContinuable()`, covering `subagent`, `subagent_fork`, and any other caller of `ctx.subagents`.
- **Hot settings reload**: the next delegation picks up edited settings immediately.
- **Clean teardown**: Cordis disposal restores the original service methods.
- **Native settings card**: configure it under `Settings → Plugins → Subagent default model`.

## How it works

```text
explicit request agentOptions
  → subagent-default-model settings
  → inherit parent-session route
```

- An explicitly provided `agentOptions` object is never modified.
- A non-empty `models` list takes precedence over the compatibility `model` field.
- Invalid or incomplete entries are ignored; with no valid configuration the parent-session route is used.
- Multi-model strategies support sequential rotation and independent random selection.

## Preview

### Settings panel

Configure one or more model routes, the distribution strategy, and per-route reasoning effort.

![Subagent default model settings panel](assets/pic_01.png)

### Distribution verification

10 subagents split 5/5 between `deepseek-v4-flash` and `Kimi-k3` with the round-robin strategy.

![Subagent default model distribution](assets/pic_02.png)

## Install

Install the published npm version with the DSH plugin command:

```sh
dsh plugin --profile desktop add dsh-subagent-default-model
```

Replace `desktop` with your profile name if you use another one. You can also install directly via npm:

```sh
npm install dsh-subagent-default-model
```

After installing, updating, or removing the bundle, restart the corresponding DSH process; only changing settings does not require a restart.

## Configuration

Configure via the Web settings card or by editing `~/.dsh/settings.yaml`.

### Pin a default model

```yaml
subagent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro
```

### Multi-model rotation

```yaml
subagent-default-model:
  provider: deepseek-official
  models:
    - deepseek-v4-pro
    - deepseek-v4-flash
    - provider: other-provider
      model: another-model
      reasoningEffort: high
  strategy: round-robin # round-robin | random
```

### Connection-failure failover (enabled by default)

When a subagent loop hits a connection-class failure, the plugin automatically switches to another model in the `models` list and retries by `strategy` — **subagents only; the main agent loop is never affected**.

- **Trigger codes**: switching only happens on `RATE_LIMIT`, `QUOTA`, `SERVER`, `TIMEOUT`, `TRANSPORT`, or `EMPTY_RESPONSE`. Authentication errors (e.g. `AUTH`) do not trigger a switch.
- **Queue**: with `round-robin`, switch to the next model in list order.
- **Random**: with `random`, pick any model (without checking whether it was used before).
- **Needs ≥ 2 models**: the feature is inert when `models` has fewer than 2 entries.
- **Exhaustion passes through**: after every model in the list has failed, the real error is passed through — no infinite retry.
- **Inherited `reasoningEffort` is dropped on switch**: after moving to a new provider/model, request at the default reasoning effort to avoid forcing the main model's effort onto a provider that does not support it.
- **Run-sticky**: subsequent steps of the same subagent run stay on the switched model.
- **Visible in trajectory**: the provider/model used for each request shows in the subagent's **trajectory view** — after a switch (including failover), a new row `Current provider/model: provider/model` appears, so you can confirm which model the retry/switch actually used.
- This behavior is controlled by the `failoverEnabled` switch, default `true`:

```yaml
subagent-default-model:
  provider: deepseek-official
  models:
    - deepseek-v4-pro
    - deepseek-v4-flash
  failoverEnabled: true # switch model by queue/strategy on connection failure
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `provider` | string | — | Provider shared by string model entries. |
| `model` | string | — | Single model ID, kept for backward compatibility. |
| `models` | array | `[]` | List of string or `{ provider, model, reasoningEffort? }` entries. |
| `strategy` | string | `round-robin` | Multi-model distribution strategy. |
| `failoverEnabled` | boolean | `true` | Switch model by queue/strategy inside `models` on connection failure (subagents only). |
| `reasoningEffort` | string | — | Optional per-route reasoning effort. |

## Marketplace

The plugin ships with an installable `dsh.bundle` manifest and is published to npm. Community marketplaces usually sync entries from the [Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) registry; the submission draft lives at [`awesome-dsh-plugin-submission/dingminhua__dsh-subagent-default-model--plugin.yml`](awesome-dsh-plugin-submission/dingminhua__dsh-subagent-default-model--plugin.yml).

Marketplace screenshots and GitHub README badges are two separate mechanisms:

- **GitHub badges** are generated by the Shields/dshfind image links at the top of this README.
- **Marketplace screenshots** are controlled by the registry `data/screenshots.json`; when unset, the marketplace tries to extract images from the README.
- **Marketplace icon/placeholder** follows each marketplace's own display rules — it is neither a generic `package.json` field nor a README badge.

## Development

```sh
npm --prefix plugin install
npm --prefix plugin test
```

Two focused regression commands are also provided at the repo root:

```sh
node integration.mjs
node prove.mjs
```

Full development notes live in [`DEVELOPMENT.md`](DEVELOPMENT.md); release steps live in [`RELEASING.md`](RELEASING.md).

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-subagent-default-model
```

After restarting DSH the bundle is no longer loaded. Any leftover configuration in `~/.dsh/settings.yaml` no longer takes effect and can be removed manually.

## License

This project is released under the [MIT License](LICENSE): **Copyright (c) 2026 LaoDing**.

The MIT License grants permission, free of charge, to any person obtaining a copy of this software to deal in it without restriction, including using, copying, modifying, merging, publishing, distributing, sublicensing, and selling copies, provided that all copies or substantial portions retain the above copyright notice and this permission notice. The software is provided "as is", without warranty of any kind. See [LICENSE](LICENSE) for the full text.
