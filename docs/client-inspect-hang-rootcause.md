# Bug 2: `cordis_inspect_query(platform=client)` hangs forever

**Status:** root cause located in the DSH Desktop build, *not* in this plugin's repository.
**Affected build:** `dsh-desktop-next` 2.0.15-next, harness packages `0.1.7-rc.2`.

## Symptom

A `cordis_inspect_query` call with `platform: "client"` never returns. The tool call
sits pending until it is cancelled, which makes the session look frozen.

## What it is *not*

It is **not** a deadlock, and it is **not** a broken client half:

* The client half is alive. `cordis_inspect_list` lists the client providers
  (`Service`, `Event`, `Builtin`, `Slots`, `Theme`) because the page published its
  manifest through `syncInspectManifest` — an RPC with **no agent scope**.
* Most client queries work. During this investigation these all returned normally:
  `Builtin.listBuiltins`, `Service.listService` (catalog, `slots`, `theme`).

## Root cause

Two defects in one path. The first turns a *failure* into a *silent wait*; the
second removes the client's only anchor for answering.

### 1. A negative answer is discarded instead of settling the query

`dsh-cordis-host-runner/lib/index.js` — `CordisInspectRegistryService.resolveClientQuery()`:

```js
resolveClientQuery(agent, requestId, resolution) {
    const pending = this.pending.get(requestId);
    if (pending === void 0 || pending.request.agentId !== agent.id) return { accepted: false };
    if (!resolution.ok) return { accepted: false };   // <-- line 799: refusal is DROPPED
    ...
    this.pending.delete(requestId);
    pending.settle(resolution);
```

The page answers *every* dispatched query, including failures — with
`{ ok: false, reason, message }` where `reason` is one of
`cancelled | provider-missing | method-missing | invalid-input | provider-error`
(the wire schema in `typert.host.js` `resolveInspectQuery_parameter_2` confirms it).
The host rejects all of those here and leaves the promise pending.

`queryClient()` then waits with **no timeout of its own**:

```js
const result = new Promise((resolve) => {
    this.pending.set(requestId, { request, method, settle: resolve });
});
signal.addEventListener("abort", onAbort, { once: true });
if (signal.aborted) onAbort();
else this.ctx.emit("cordis/inspect-query", request);
try {
    const resolution = await result;   // settles ONLY on abort or a positive answer
} finally {
    signal.removeEventListener("abort", onAbort);
}
```

The only two `settle()` call sites are the positive path (line 809) and the abort
handler (line 838). So a provider error becomes an indefinite wait, and the
`cordis_inspect_query` tool declares **no `timeoutMs`** at all
(`dsh-tool-cordis/lib/index.js` contains zero `timeoutMs` occurrences), so nothing
bounded it either.

### 2. The answer is addressed by an Agent the caller can no longer resolve

`resolveInspectQuery` is declared with scope in `typert.host.js`:

```js
scope: { context: 'agent', wire: 'agentId' }
```

while the manifest sync it is paired with has **no scope**:

```js
// syncInspectManifest — no `scope` block at all
```

That asymmetry is the whole story. On the page,
`dsh-api-gateway/lib/client.js` resolves an agent-scoped Remote event by looking the
Agent up:

```js
const adapter = this.ownerCtx.typert.contexts.getClient("agent");
resolved = adapter?.resolve(frame.agentId);
...
const target = isTypertOwnedValue(resolved) ? resolved.value : resolved;
let outcome = { kind: "next" };
if (target !== void 0) outcome = await this.dispatchWaterfall(target, frame, signal);
```

When the Agent is gone (`resolved === undefined`), `target` is `undefined`, the
waterfall is skipped, and the answer carries no result — it never reaches
`host.resolve(...)` as an `ok: true` payload. The query is then answered by
*neither* path: the positive settle never happens, and the refusal would be
discarded by defect 1 even if it were delivered.

## Reproduced A/B (same session, same page)

| Input | Result |
|---|---|
| `Builtin.listBuiltins` | returns |
| `Service.listService` (catalog) | returns |
| `Service.listService {service:"slots"}` | returns |
| `Service.listService {service:"theme"}` | returns |
| `Service.listService {service:"configForms"}` | **hangs** |
| `Service.listService {service:"definitelyNotAService"}` | **hangs** |

`configForms` is absent from the client catalog
(`layout, locale, sessions, slots, theme, timer, uiWorkspace, workspaces`), so
`queryServiceApi` throws `no catalogued Service named "configForms"`; the page
reports that as `{ ok: false, reason: "provider-error" }`; the host discards it;
the tool waits. **Valid input returns, invalid input hangs** — which is exactly
what the two defects predict.

## Minimal fix (host, one function)

Settle the pending query with the page's own refusal instead of discarding it.
The wait stays bounded by the page, and the caller gets an actionable message:

```js
resolveClientQuery(agent, requestId, resolution) {
    const pending = this.pending.get(requestId);
    if (pending === void 0 || pending.request.agentId !== agent.id) return { accepted: false };
    if (!resolution.ok) {
        // A refusal IS an answer: settle it so the caller learns why, rather
        // than waiting for a positive result that will never arrive.
        this.pending.delete(requestId);
        pending.settle(resolution);          // { ok: false, reason, message }
        this.ctx.emit("cordis/inspect-query-resolved", { requestId });
        return { accepted: true };
    }
    try {
        resolution = { ok: true, data: validateOutput("Client", pending.request.provider, pending.method, resolution.data) };
    } catch {
        return { accepted: false };
    }
    this.pending.delete(requestId);
    pending.settle(resolution);
    this.ctx.emit("cordis/inspect-query-resolved", { requestId });
    return { accepted: true };
}
```

Supporting hardening, each independent of the above:

1. `queryClient()` — reject outstanding client queries when the asking Agent is
   gone, so an agent-scoped answer has a defined failure instead of silence.
2. `dsh-tool-cordis` — declare a `timeoutMs` on `cordis_inspect_query`, so a
   pending client query surfaces as `TOOL_TIMEOUT` rather than an unbounded wait.
3. Consider dropping the `agent` scope from `resolveInspectQuery` (it is a claim
   on a *request id*, already bound to one agent on the host side), which would
   make the answer path independent of page-side Agent resolution entirely.

## Not fixed here

This is the DSH application's own code
(`.../resources/app/node_modules/@deepseek-ai/dsh-cordis-host-runner/`). Patching
it inside `app.asar` is overwritten by any DSH update, so the change belongs
upstream. The plugin in this repository is unaffected by, and cannot fix, this
defect; the workaround is to avoid `platform: "client"`.
