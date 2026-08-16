# dsh-subagent-default-model

A standalone [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle plugin that selects a default model for child-agent delegations through `~/.dsh/settings.yaml`.

It changes only subagent requests that omit `agentOptions`; DSH core packages remain unmodified.

## Behavior

The plugin registers the `subagent-default-model` settings section and wraps the host `ctx.subagents` service while the plugin fiber is active.

Model precedence is:

```text
explicit request agentOptions
  → subagent-default-model setting
  → inherited parent-session route
```

The wrapper applies to both `start()` and `startContinuable()`, covering the stock `subagent` and `subagent_fork` paths as well as other callers of the service.

- An explicit `agentOptions` object is never changed.
- Missing or incomplete configuration adds nothing, so the child inherits the parent route.
- A non-empty `models` list takes precedence over the single `model` form.
- The settings reader is live: edits to `settings.yaml` affect the next delegation.
- Service wrappers are restored when Cordis disposes this plugin, so a later remount starts cleanly.

## Configuration

Add one of these forms to `~/.dsh/settings.yaml`.

### One fixed child model

```yaml
subagent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro
```

### Several child models

```yaml
subagent-default-model:
  provider: deepseek-official # default provider for string entries
  models:
    - deepseek-v4-pro
    - deepseek-v4-flash
    # Explicit cross-provider entry:
    # - provider: kimi
    #   model: kimi-k3
  strategy: round-robin # round-robin (default) or random
```

`round-robin` picks valid entries in order. `random` picks a valid entry independently for each delegation. Invalid or incomplete entries are ignored; if no valid entry remains, the child inherits the parent route.

## Install

Install the package into the DSH profile that should use it:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-subagent-default-model/plugin
```

For a headless profile, replace `web` with `headless`.

The package declares its `cordis.patch.yml` as a DSH bundle patch. Restart the relevant DSH process after adding or removing the bundle so that its profile composition is rebuilt. Settings-file edits are hot-reloaded and do not require a restart.

## Web settings

The host plugin deliberately does not register a second web settings row. The **子代理默认模型** row in **设置 → 通用设置** is supplied by the maintained local fork at `vendor/dsh-subagent-max`.

The row can:

- leave the selection empty to inherit the parent-session route;
- add or remove one or more provider/model routes;
- preserve stored routes that are temporarily unavailable from the model catalog; and
- choose `round-robin` or `random` when multiple routes are configured.

Its saved value uses the same `subagent-default-model` section described above. It preserves unrelated fields in that section and never collapses an existing model list merely because the settings panel was opened.

For the local web profile used in this checkout, link the fork and restart the web process after changing its client bundle:

```bash
pnpm --dir ~/.dsh/profiles/web install
dsh web
```

The profile must load either this fork or another single owner of the `subagent-model` row—never both—so the settings panel cannot render duplicate controls.

## Development and tests

The plugin package owns its test dependencies and test command:

```bash
npm --prefix plugin install
npm --prefix plugin test
```

The tests use a real Cordis context and settings provider with a fake `subagents` service. They verify:

- fixed and multi-model selection;
- round-robin routing and live settings updates;
- explicit per-call override and fallback behavior;
- normal and continuable child-agent requests;
- Cordis disposal restoring the exact original service methods; and
- the stable raw-service identity needed when Cordis returns traceable proxies.

The root compatibility commands run focused parts of the same suite:

```bash
node integration.mjs # delegation and lifecycle integration tests
node prove.mjs       # Cordis traceable-proxy regression test
```

## End-to-end verification

1. Install the bundle into a disposable profile and configure a known model or two-model `round-robin` list.
2. Restart the corresponding DSH process.
3. Create several child agents without explicitly choosing a model.
4. Inspect each child session's `request/header.config.model` in:

   ```text
   ~/.dsh/sessions/<workspace>/<child-id>/session.jsonl.zstd
   ```

   A configured round-robin list such as `pro, flash` should produce `pro → flash → pro` for consecutive child requests. A child created with explicit `agentOptions` should retain that explicit model.
