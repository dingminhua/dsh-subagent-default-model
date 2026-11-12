import { createUserMessage } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";

/**
 * dsh-subagent-default-model — default model(s) for subagent delegations.
 *
 * Host-plane plugin. It declares its configurable surface as the plugin's own
 * Cordis `Config` (DSH 0.1.7+ "settings model": a plugin's `Config` IS the
 * settings section). The host projects this `Config` into a settings form keyed
 * by the Loader entry id (`dsh-subagent-default-model`) and writes changes back
 * to the profile patch; volatile fields hot-reload without re-mounting the
 * plugin. This plugin then wraps the host `ctx.subagents` service
 * (`start` / `startContinuable`), so any delegation whose request carries no
 * explicit `agentOptions` (the stock `subagent` / `subagent_fork` tools and
 * every other tool that omits model/provider) creates the child with a
 * configured default model. Explicit per-call overrides (e.g.
 * `subagent_with_model`) always win; an absent or incomplete section keeps the
 * historical behavior: children inherit the parent session route.
 *
 * Multiple models are supported: the `models` list is picked from on every
 * delegation either round-robin (default) or at random (`strategy`), so a
 * batch of parallel subagents spreads across the configured models. The
 * selection is re-evaluated on every call (live Config reference + live picker
 * state), so configuration changes apply to the very next delegation.
 *
 * The wrap lives on the service, not on any tool, so it covers every
 * delegation path without touching the core `dsh-tool-subagent` package.
 *
 * Optional subagent-only error failover: with `failoverEnabled` on (the
 * default), this plugin hooks the agent loop's `agent/request-error` and
 * `agent/request` waterfalls (the same seams the community dsh-llm-fallback /
 * dsh-model-failover plugins use) and — when a SUBAGENT's own loop hits a
 * connection failure (rate limit, quota, server/transport error, empty
 * response) — transparently retries that request on another model from the
 * SAME `models` list, following the SAME `strategy` (round-robin advances
 * through the list as a queue; random picks any entry without checking whether
 * it was used before). The gate is `agent.session.header.origin ===
 * "subagent"` (the durable marker every subagent child session carries), so the
 * MAIN agent's loop is never touched: failover is strictly subagent-only by
 * construction. Per-subagent state is cleaned on `agent/disposed`, so a broken
 * subagent primary is not re-tried on every step of the same run.
 */

export const name = "dsh-subagent-default-model";
// Do not hard-inject `subagents` at the plugin root: DSH may mount that
// service after this row. The settings surface is the declared `Config` (the
// host projects it independently of any service wave); `apply()` attaches the
// service wrapper through `ctx.inject()`.
//
// There is deliberately no settings-namespace constant here: on 0.1.7 the
// namespace IS this Loader entry id (`dsh-subagent-default-model`), and the
// host — not this plugin — owns that mapping. The client resolves the served
// namespace from the configForms mirror instead of guessing it.

/**
 * Mark a schema's field as volatile, on every schemastery build.
 *
 * The marker is NOT optional decoration: `@deepseek-ai/dsh-settings` derives the
 * settings surface from it in two places, and BOTH fail silently without it.
 *
 *   - `volatileForm(schema)` (dsh-settings `lib/index.js`) returns `undefined`
 *     when no field carries the marker, and `describe()` then DROPS the entry
 *     from the namespace directory (`if (form === void 0) return []`). The
 *     entry never reaches the client's describe mirror, so the settings card's
 *     forwarding scope never binds and every Save reports
 *     `notApplied:unavailable:writable=false` — a "the Host serves no settings
 *     store for this plugin" error for a plugin the Host is serving perfectly.
 *   - `isVolatilePath(schema, path)` refuses every edit whose path is not under
 *     a marked node, with `Config field "…" is not volatile`.
 *
 * `volatile()` is sugar introduced in schemastery 3.18.4 — upstream it is
 * literally `extra("volatile", true)` behind a double-marking guard. A stale or
 * hoisted 3.18.1 install is entirely reachable (observed: the vendored copy was
 * 3.18.1, so `volatile()` was absent and the marker was never applied — the
 * plugin loaded, the card rendered, and every Save failed with the message
 * above). `extra()` exists in both builds, so falling back to it keeps the exact
 * 3.18.4 semantics and also works where `volatile()` is missing; the declared
 * dependency floor is therefore 3.18.1. A schema offering neither method is
 * returned unchanged rather than breaking the plugin at module-eval time.
 *
 * @template T
 * @param {object} schema - a schemastery field.
 * @returns {object} the field, marked volatile whenever the build allows it.
 */
export function volatileField(schema) {
	if (typeof schema?.volatile === "function") return schema.volatile();
	// Pre-3.18.4 fallback: identical marker, no double-marking guard needed
	// because `extra` is a plain assignment of the same meta key.
	if (typeof schema?.extra === "function" && schema.meta?.volatile !== true) {
		return schema.extra("volatile", true);
	}
	return schema;
}

/** One model entry: a bare model id (uses the section `provider`) or an explicit `{provider, model}` pair. */
const MODEL_ENTRY = z.union([
	z.string(),
	z.object({
		provider: z.string(),
		model: z.string(),
		reasoningEffort: z.string()
	})
]);
/** Schema of the `subagent-default-model` settings section; an absent section keeps inheriting the parent route. */
// EVERY field MUST carry a `.default(...)`, including the string ones that
// would naturally be "absent when unset". The settings surface is built by
// `projectForm()` (`@deepseek-ai/dsh-settings`), which walks the form schema and
// DROPS any field whose resolved value is `undefined`:
//
//     return field === void 0 ? [] : [[key, projectForm(child, field)]];
//
// A bare `z.string()` with no default resolves to `undefined`, so such a field
// is absent from the descriptor the settings card reads AND writes against. The
// card then compares its draft (`provider: "workbuddy"`) to a descriptor that
// never mentions `provider`, and reports the misleading
// `notApplied:ready:writable=true`: the scope is ready and writable, and the
// field it wrote is simply not one this form can see. Declaring `""` as the
// default keeps the field present-and-empty, which is exactly the "inherit the
// parent route" state the rest of this plugin already treats as unset
// (`defaultModel()` tests `section.model.length > 0`).
const SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA = z.object({
	provider: volatileField(z.string().default("").description("Default provider for subagent runs without an explicit agentOptions")),
	model: volatileField(z.string().default("").description("Default model id; the single-model form, backward compatible")),
	models: volatileField(z.array(MODEL_ENTRY).default([]).description("Multi-model list; picked per strategy on every delegation")),
	strategy: volatileField(z.union([z.const("round-robin"), z.const("random")]).default("round-robin").description("How to pick from `models`")),
	failoverEnabled: volatileField(z.boolean().default(true).description("Retry a subagent request on another pool model after a connection failure")),
	// Tell the SUBAGENT which provider/model it is actually running on, by
	// injecting one text line into its own context. Default ON: without it a
	// subagent cannot answer "which model are you?" because the route is chosen
	// by the parent and never appears in the child's prompt.
	//
	// Declared volatile like every other configurable field: the settings write
	// gate rejects any path that is not a declared volatile field.
	injectRouteContext: volatileField(z.boolean().default(true).description("Tell a subagent the route it is actually running on, and the main agent which model its delegations will use")),
	// Must be DECLARED and volatile: the settings write gate rejects every path
	// that is not a declared volatile field (`@deepseek-ai/dsh-settings`
	// `write()` throws `Config field "…" is not volatile`). The client card
	// writes this key as part of EVERY save, so omitting it made every save
	// fail — not just the reasoning-effort field. It also carries the
	// single-model form's effort, which `defaultModel()` reads back.
	reasoningEffort: volatileField(z.string().default("").description("Reasoning effort for the single-model form (`model`)")),
	// Whether the same-context delegation channels (`subagent_fork`) follow this
	// plugin's configured route instead of inheriting the parent's.
	//
	// Default FALSE, i.e. fork children keep the parent route. The host's `fork`
	// backend sets `inheritsParentContext = true` and is SEEDED with a prefix of
	// the parent's session log, so its whole point is provider-side reuse of that
	// prefix (KV cache). `dsh-base` spells the intent out where the fork tool is
	// wired: "Fork omits model selection so provider/model stay equal to the
	// parent and the inherited history remains eligible for KV Cache reuse."
	//
	// Measured cost of ignoring that: one real fork child sent its first request
	// with `inputTokens: 144185, cacheReadTokens: 186` — i.e. the inherited
	// 141-message prefix was re-billed in full on the other provider instead of
	// being served from cache. Later steps are fine (the new provider builds its
	// own cache), so the loss is a one-off first-request penalty, but it is a
	// large one.
	//
	// Opting IN is a deliberate trade: you want fork children on the pool route
	// and accept paying to re-run the inherited prefix once.
	applyToForkChildren: volatileField(z.boolean().default(false).description("Let same-context channels (subagent_fork) follow the configured route instead of inheriting the parent's; off keeps the host's KV-cache reuse")),
	// Whether a subagent whose turn died on a FAILOVER-ELIGIBLE failure is woken
	// for one more turn, so the route `agent.model.select()` just chose is
	// actually used instead of waiting for somebody to send more input.
	//
	// WHY THIS IS NEEDED AT ALL. On DSH 0.2.2+ the failing step keeps its fixed
	// route, so the switch only takes effect on a LATER turn. Without a wake, a
	// one-shot `subagent` simply ends: the pool is switched to a healthy route
	// that never gets used, and the parent is told the child failed. Measured
	// before this existed: a pool route returned 429, failover selected the
	// healthy entry, and the child still ended `error` with zero further
	// requests.
	//
	// Default ON, because "switch, then keep working" is the whole point of the
	// failover feature; `false` restores the pre-2.2.3 behaviour (switch recorded,
	// current turn ends).
	continueAfterFailover: volatileField(z.boolean().default(true).description("Wake a subagent for one more turn after a failover switch, so the healthy route is actually used instead of ending the task")),
	// How many consecutive automatic continuations one subagent run may have.
	// A pool of N entries can only switch N-1 times, so a cap above that would
	// never be reached; the failover pool-exhaustion rule is the real bound.
	// Kept separate because it is what stops a pathological loop when the pool
	// keeps being edited while the run is alive.
	maxAutoContinues: volatileField(z.number().default(2).description("Maximum consecutive automatic continuations per subagent run (0 disables)"))
}).default({});

/** The plugin's Cordis Config — on DSH 0.1.7+ this IS the settings section. */
export const Config = SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA;

/** State retained on the raw host service while this plugin fiber is active. */
const WRAPPED = Symbol.for("dsh-subagent-default-model.wrapped");

// ── subagent-only error failover ─────────────────────────────────────────────

/**
 * Failure codes that count as "connection failed" (rate limit, quota, server /
 * transport errors, empty responses). Switching on these is safe because a
 * different model/provider may well succeed where the primary just failed.
 */
const FAILOVER_TRIGGER_CODES = ["RATE_LIMIT", "QUOTA", "SERVER", "TIMEOUT", "TRANSPORT", "EMPTY_RESPONSE"];

/**
 * Auth failures, handled SEPARATELY from the connection codes above.
 *
 * `AUTH` (HTTP 401/403 — a bad, expired, or unauthorised key) is not a
 * connectivity problem, so switching on it is only right when the pool entries
 * hold INDEPENDENT credentials. With per-provider keys — the normal setup — one
 * provider's key going bad must not kill the whole delegation while healthy
 * providers sit unused, which is what excluding AUTH entirely used to do.
 *
 * The reason AUTH was originally excluded still stands, though: silently
 * rerouting around a broken key HIDES a misconfiguration. So an AUTH switch is
 * always accompanied by a loud warning naming the provider whose credentials
 * were refused, and pool exhaustion still passes the real error through.
 * Observability replaces suppression.
 *
 * When several entries share ONE credential (e.g. the same env var), switching
 * cannot help — but it also cannot loop: every candidate is tried at most once
 * per run, and exhaustion surfaces the real error.
 */
const AUTH_FAILURE_CODES = ["AUTH", "INVALID_CREDENTIAL"];

/** Every failure code that may trigger a switch. */
const FAILOVER_ELIGIBLE_CODES = [...FAILOVER_TRIGGER_CODES, ...AUTH_FAILURE_CODES];

/**
 * Whether this host fixes the step's route and only sanctions changing it
 * through `agent.model.select()`.
 *
 * DSH 0.2.2 replaced the per-request route with a STEP-FIXED selection:
 * `preStep()` reads `agent.model.current()` once and hands the result to the
 * `agent/request` waterfall as `modelSelection`, which the type documents as
 * "captured step selection, retained across retries". A listener that returns
 * a different provider/model now throws
 * `agent "X": agent/request proposed "p/m" after step preparation fixed "a/b"`
 * — the waterfall itself is marked `@deprecated` for this use ("a replacement
 * may adjust controls but must keep the provider, model, and reasoning effort
 * selection").
 *
 * `agent.model` does not exist before 0.2.2, so this is a capability probe
 * rather than a version compare: one plugin build serves both hosts.
 */
function fixesStepRoute(agent) {
	return typeof agent?.model?.select === "function";
}

/** True when a failure code is an auth-class failure (picks the log wording). */
function isAuthFailure(code) {
	return AUTH_FAILURE_CODES.includes(code);
}

/** Resolve one model entry to `{provider, model}`, or undefined. */
function resolveEntry(section, entry) {
	if (typeof entry === "string") {
		if (entry.length === 0) return void 0;
		if (typeof section.provider !== "string" || section.provider.length === 0) return void 0;
		return { provider: section.provider, model: entry };
	}
	if (entry !== null && typeof entry === "object") {
		if (typeof entry.provider !== "string" || entry.provider.length === 0) return void 0;
		if (typeof entry.model !== "string" || entry.model.length === 0) return void 0;
		const resolved = { provider: entry.provider, model: entry.model };
		if (typeof entry.reasoningEffort === "string" && entry.reasoningEffort.length > 0) {
			resolved.reasoningEffort = entry.reasoningEffort;
		}
		return resolved;
	}
	return void 0;
}

/** Pick the next default model from the live settings section, or undefined to inherit the parent route. */
function defaultModel(state) {
	const section = state.getSection?.();
	if (section === void 0 || section === null) return void 0;

	// Multi-model list wins; pick per strategy.
	const entries = Array.isArray(section.models) ? section.models.filter((entry) => resolveEntry(section, entry) !== void 0) : [];
	if (entries.length > 0) {
		const picked = section.strategy === "random"
			? entries[Math.floor(Math.random() * entries.length)]
			: entries[state.rrCursor++ % entries.length];
		return resolveEntry(section, picked);
	}

	// Single-model form (backward compatible).
	if (typeof section.model === "string" && section.model.length > 0) {
		if (typeof section.provider !== "string" || section.provider.length === 0) return void 0;
		const result = { provider: section.provider, model: section.model };
		if (typeof section.reasoningEffort === "string" && section.reasoningEffort.length > 0) {
			result.reasoningEffort = section.reasoningEffort;
		}
		return result;
	}

	return void 0;
}

/**
 * Whether one delegation's provider reuses the parent's conversation prefix.
 *
 * `inheritsParentContext === true` is the host's own statement that this backend
 * is seeded with the parent's session log (currently only the `fork` backend).
 * Route changes on such a child invalidate the KV cache the host preserved on
 * purpose, so they are treated differently from a fresh-context spawn.
 *
 * @param ctx - the plugin context (reads `subagents`).
 * @param provider - the provider name from the delegation spec.
 * @returns {boolean} true when children on this provider inherit the prefix.
 */
function inheritsParentContext(ctx, provider) {
	if (typeof provider !== "string" || provider.length === 0) return false;
	try {
		const subagents = ctx.subagents ?? ctx.get?.("subagents");
		const entry = subagents?.getProvider?.(provider);
		return entry?.inheritsParentContext === true;
	} catch {
		// An unreadable registry must not turn into "skip every delegation": fall
		// back to the fresh-context behaviour (inject), which is the long-standing
		// default and never silently disables the feature.
		return false;
	}
}

/** Inject the default model into one delegation request unless it already names one. */
function applyDefaultModel(state, request) {
	if (request === void 0 || request === null) return request;
	if (request.agentOptions !== void 0) return request;
	const model = defaultModel(state);
	if (model === void 0) return request;
	return { ...request, agentOptions: model };
}

/**
 * The provider-aware form of {@link applyDefaultModel}: also honours
 * `applyToForkChildren` for same-context (`fork`) delegations.
 *
 * A fork child that is left alone keeps the parent route, exactly as the host
 * intends; when the user opts in, the pool route is injected as for any other
 * child. A skip is logged ONCE per provider so "configured but not applied" is
 * never silent — the 2.1.7 failure mode was exactly that.
 *
 * @param ctx - the plugin context, used to read provider capabilities.
 * @param state - the plugin state.
 * @param request - the delegation request.
 * @param provider - the provider name the spec targets.
 * @returns the request, possibly with `agentOptions` injected.
 */
function applyDefaultModelFor(ctx, state, request, provider) {
	if (request === void 0 || request === null) return request;
	// An explicit route always wins, regardless of the fork policy.
	if (request.agentOptions !== void 0) return request;
	if (inheritsParentContext(ctx, provider) && state.getSection()?.applyToForkChildren !== true) {
		// Logged once per provider per fiber: this fires on EVERY fork delegation,
		// and a line per delegation would be the same log spam this plugin
		// already fixed for context injection. It is still logged at all because
		// "configured but silently not applied" is the exact failure mode that
		// took a release to diagnose (2.1.7).
		if (state.forkSkipNoticed?.has(provider) !== true) {
			(state.forkSkipNoticed ??= new Set()).add(provider);
			ctx.logger?.info?.(
				"[dsh-subagent-default-model] %s children inherit the parent conversation, so the configured route is NOT applied to them (set applyToForkChildren: true to override). They stay on the parent route so that prefix keeps its KV-cache reuse.",
				provider
			);
		}
		return request;
	}
	return applyDefaultModel(state, request);
}

// ── subagent-only error failover ─────────────────────────────────────────────

/** Read the live failover view: the `models` list as the switch pool and the strategy. */
function failoverView(state) {
	const section = state.getSection?.();
	if (section === void 0 || section === null) return void 0;
	if (section.failoverEnabled === false) return void 0;
	// Deduplicate by provider+model.
	//
	// A pool such as `["a", "a"]` — or two entries that happen to resolve to the
	// same route — is not a two-route pool: `AgentModel.select()` compares the
	// new selection with the recorded one and returns WITHOUT appending
	// `model/selection` when they match. The "switch" would then be a silent
	// no-op while this plugin still recorded a switch and woke the child, so the
	// continuation re-requested the same dead route. Distinct
	// `reasoningEffort` values still count as distinct selections (the host
	// compares effort too), so the key includes it.
	const resolved = Array.isArray(section.models)
		? section.models.map((entry) => resolveEntry(section, entry)).filter((entry) => entry !== void 0)
		: [];
	const seen = new Set();
	const entries = resolved.filter((entry) => {
		const key = `${entry.provider}\u0000${entry.model}\u0000${entry.reasoningEffort ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	// A pool of <2 DISTINCT models has nothing to switch to; keep the parent route.
	if (entries.length < 2) return void 0;
	return { entries, strategy: section.strategy === "random" ? "random" : "round-robin" };
}

/** True only for a SUBAGENT-origin agent (the durable session header marker). */
function isSubagentAgent(agent) {
	return agent !== void 0 && agent !== null && agent.session?.header?.origin === "subagent";
}

/**
 * Pick the next pool index for one failed subagent request.
 *
 * - round-robin: the next entry after the currently-served model, wrapping
 *   around the list (the "queue"), skipping entries this run already tried so a
 *   single bad candidate is not re-selected while an untried one remains.
 * - random: uniformly among the entries this run has NOT already tried.
 *   Deliberately NOT "any entry": `model.select()` is a silent no-op when the
 *   selection equals the current one, so picking a dead route again records
 *   nothing and the continuation re-requests it. `tried` therefore carries both
 *   the routes switched to and the route that failed (seeded by the caller).
 *
 * @param view - pool entries and strategy.
 * @param agent - the failing subagent (its live route is the fallback anchor).
 * @param current - this run's switch bookkeeping, if any.
 * @param seededTried - `current.tried` already extended with the failed route.
 * @returns the chosen pool index.
 */
function nextFailoverIndex(view, agent, current, seededTried = undefined) {
	const { entries, strategy } = view;
	const tried = seededTried ?? current?.tried;
	if (strategy === "random") {
		// A random pick must still be a USEFUL pick. The naive
		// `Math.random() * entries.length` ignored both `tried` and the route
		// that just failed, so it re-selected the dead entry with probability
		// 1/entries.length — and worse, it could return the very entry the
		// failure came from.
		//
		// Measured consequence: `model.select()` compared the "new" selection
		// with the current one, found them equal, and returned WITHOUT appending
		// `model/selection`. The switch silently did nothing, the continuation
		// turn re-requested the same dead route, and the child failed again.
		// The diagnostic read exactly that: `selecting minmax/… (before=minmax/…)`
		// followed by an unchanged `current()` and an unchanged session seq.
		//
		// Only entries this run has not already tried are candidates. `tried` is
		// seeded by `switchForNextStep` with BOTH the route that just failed and
		// every route it has switched to, so "already failed here" is fully
		// represented — that is what keeps a random pick useful instead of
		// re-selecting a dead entry (which makes `model.select()` a silent no-op).
		const blocked = new Set(tried ?? []);
		const candidates = entries
			.map((entry, index) => index)
			.filter((index) => !blocked.has(index));
		// DEFENSIVE, currently unreachable: the caller returns on
		// `count >= entries.length - 1` before calling, and every switch adds a
		// distinct index, so at least one candidate always remains. Kept anyway —
		// if that guard ever changes, returning `undefined` here would silently
		// select nothing, whereas an index still lets the caller decide.
		if (candidates.length === 0) return Math.floor(Math.random() * entries.length);
		return candidates[Math.floor(Math.random() * candidates.length)];
	}
	if (current !== void 0) {
		// Advance from the last pick, taking the first entry this run has not used.
		for (let step = 1; step <= entries.length; step += 1) {
			const candidate = (current.index + step) % entries.length;
			if (tried === void 0 || !tried.has(candidate)) return candidate;
		}
		return (current.index + 1) % entries.length;
	}
	// First failure: locate the served route in the pool and move to the next.
	const served = agent.session?.requestContext?.();
	const found = served === void 0 ? -1 : entries.findIndex((entry) =>
		entry.provider === served.provider && entry.model === served.model
	);
	if (found < 0) return 0;
	// Start after the served entry, preferring one this run has not used.
	for (let step = 1; step <= entries.length; step += 1) {
		const candidate = (found + step) % entries.length;
		if (tried === void 0 || !tried.has(candidate)) return candidate;
	}
	return (found + 1) % entries.length;
}

/**
 * Record a healthy route for the steps that FOLLOW a failure (DSH 0.2.2+).
 *
 * On these hosts the failed request cannot be re-routed: `preStep()` captured
 * the step's selection and `agent/request` must hand it back unchanged, so a
 * retry re-issues to the same dead route. The one sanctioned lever is
 * `agent.model.select()`, whose result is read at the NEXT step preparation.
 *
 * Therefore:
 *
 * 1. ask the rest of the waterfall first. `dsh-llm-retry` owns backoff and is
 *    mounted in the base composition; a transient failure it recovers must NOT
 *    move the route, and pre-empting it here (as the pre-0.2.2 path does, where
 *    the retry carried a new route) would strip the backoff for no gain.
 * 2. if nothing retries, this route is the reason the turn dies. Select the
 *    next untried pool entry so any later step or turn starts on a healthy
 *    route, and let the ORIGINAL error surface — it names the real cause
 *    (quota, auth), unlike the host's "after step preparation fixed" guard.
 *
 * The visible consequence, stated plainly: on 0.2.2 a permanently failing
 * route still ends the CURRENT turn — the host fixes its route, so that turn
 * cannot continue elsewhere. What the selection buys is everything after it,
 * and `onSwitched` (see `installAutoContinue`) is what makes "after it" happen
 * without waiting for the parent: it wakes the child for one more turn once the
 * agent goes idle, so the new route is actually used.
 */
async function switchForNextStep(ctx, state, pending, payload, next, onSwitched) {
	const { agent, step, failure, signal } = payload;
	const downstream = await next();
	if (signal?.aborted) return downstream;
	// Someone downstream (llm-retry) is recovering this request: leave the
	// route alone, since the failure may be transient.
	if (downstream?.kind === "retry") return downstream;
	// Re-read the view: the settings may have changed while we awaited.
	const view = failoverView(state);
	if (view === void 0) return downstream;
	const current = pending.get(agent.id);
	// Guard on turn AND step. A continuation turn restarts at step 1, so a
	// step-only guard treats a fresh turn's first failure as "already switched
	// for this step" and silently refuses to switch again — capping a one-shot
	// child at ONE failover no matter how large the pool is (measured: a 3-entry
	// pool only ever reached the second entry).
	if (current !== void 0 && current.turn === payload.turn && current.step === step) return downstream;
	if (current !== void 0 && current.count >= view.entries.length - 1) return downstream; // pool exhausted
	// Seed `tried` with the route that FAILED, not just the ones already switched
	// to.
	//
	// `tried` used to record only switch targets, so the route that failed FIRST
	// never entered it. From the second switch onward that dead route was a legal
	// candidate again — no longer `served`, and filtered by nothing — so `random`
	// could send the child straight back to it. Measured with a fixture whose
	// route follows `select` (as the host's own fold does) and a three-entry
	// pool: 136 of 300 second switches returned to the original dead route, and
	// the `entries.length - 1` cap then left the third entry never tried.
	//
	// This must run BEFORE `nextFailoverIndex`, which is the only consumer.
	const tried = new Set(current?.tried ?? []);
	if (current === undefined) {
		// Identify the served entry by provider + model + effort.
		//
		// Locate the served entry by provider + model + effort.
		//
		// `session.requestContext()` carries no `reasoningEffort`, but the host's
		// `AgentModel.select()` compares effort as part of the selection. A pool
		// differing only by effort (`[a/high, a/low]`) would then resolve the
		// served route to the WRONG entry and pick the very selection the child is
		// already on — a silent no-op that still costs a wake.
		//
		// `requestHeader().config` is the route the LAST REQUEST actually used,
		// including effort, and is exactly what `selectionOfHeader()` feeds the
		// host's comparison. `model.current()` would also carry effort but reads
		// `pending ?? lastUsed`, so another plugin's not-yet-used selection could
		// name an entry this run never actually served.
		const live = agent?.session?.requestHeader?.()?.config
			?? agent?.model?.current?.()
			?? agent?.session?.requestContext?.();
		if (live !== void 0 && live !== null) {
			const servedIndex = view.entries.findIndex((entry) =>
				entry.provider === live.provider
				&& entry.model === live.model
				&& (entry.reasoningEffort ?? void 0) === (live.reasoningEffort ?? void 0)
			);
			if (servedIndex >= 0) tried.add(servedIndex);
		}
	}
	const index = nextFailoverIndex(view, agent, current, tried);
	const target = view.entries[index];
	if (target === void 0) return downstream;
	// Record the route that FAILED too, not just the one being selected.
	//
	tried.add(index);
	try {
		agent.model.select({
			provider: target.provider,
			model: target.model,
			...(target.reasoningEffort === void 0 ? {} : { reasoningEffort: target.reasoningEffort })
		});
	} catch (error) {
		// A host that exposes `model.select` but refuses this call is not a
		// reason to swallow the real failure — report it and let the original
		// error through.
		ctx.logger.warn(
			`[dsh-subagent-default-model] could not pre-select %s/%s after %s; the subagent keeps its route: %s`,
			target.provider,
			target.model,
			failure.code,
			error instanceof Error ? error.message : String(error)
		);
		return downstream;
	}
	// Record ONLY a selection that actually landed: an incremented `count` for a
	// switch the host refused would retire a pool entry that was never used and
	// stop the next step from retrying it.
	pending.set(agent.id, {
		index,
		tried,
		count: (current?.count ?? 0) + 1,
		step,
		turn: payload.turn
	});
	ctx.logger.warn(
		`[dsh-subagent-default-model] subagent %s failed with %s on turn %d step %d; %s/%s is selected for its NEXT step (this host fixes the route of the failed step, so the current turn cannot continue on it)`,
		agent.id,
		failure.code,
		payload.turn,
		step,
		target.provider,
		target.model
	);
	if (isAuthFailure(failure.code)) {
		ctx.logger.warn(
			`[dsh-subagent-default-model] the credentials for the failing provider %s were refused (%s). This is NOT a connection problem: that provider's API key is likely invalid, expired, or unauthorised. The next step will use %s/%s — verify the failing provider's key, because every request routed to it will fail until it is fixed.`,
			payload.provider ?? "(unknown)",
			failure.code,
			target.provider,
			target.model
		);
	}
	// The selection only lands on the NEXT step. A one-shot subagent never
	// starts one, so without this the switch would be recorded and wasted.
	// Told from HERE rather than from a second listener on the same waterfall:
	// that would depend on listener order and on re-reading `pending`, which is
	// exactly the coupling this call avoids. It runs after the selection landed.
	// A throw here must not abort the host's failure waterfall and replace a real
	// provider error with a plugin crash; the switch has already landed.
	try {
		onSwitched?.(agent, failure);
	} catch (error) {
		ctx.logger?.warn?.(
			`[dsh-subagent-default-model] could not schedule a continuation for subagent %s after %s: %s`,
			agent?.id,
			failure?.code,
			error instanceof Error ? error.message : String(error)
		);
	}
	return downstream;
}

/**
 * Install the subagent-only failover waterfalls. Both listeners no-op for the
 * main agent (origin gate) and for subagents whose failure code is not a
 * connection failure, so a broken subagent primary is re-tried on the next
 * pool model without ever touching the parent loop. State is keyed per
 * subagent run (`agent.id`) and cleaned on `agent/disposed`, so a persistently
 * broken primary is not re-tried on every step of the same run.
 */
function installFailover(ctx, state, onSwitched) {
	const pending = new Map();

	// After a model failure on a subagent loop: advance the pool index and ask
	// the loop to rebuild the request (`{ kind: "retry" }`). When every pool
	// entry has been tried, let the real error surface untouched.
	const disposeRequestError = ctx.on("agent/request-error", async (payload, next) => {
		const view = failoverView(state);
		if (view === void 0) return next();
		const { agent, turn, step, failure, signal } = payload;
		if (signal?.aborted) return next();
		if (!isSubagentAgent(agent)) return next();
		if (failure === void 0 || !FAILOVER_ELIGIBLE_CODES.includes(failure.code)) return next();
		// 0.2.2+ fixed the route for the whole step, so the route cannot be
		// swapped on the retry this hook used to request. See
		// `switchForNextStep` for what replaces it.
		if (fixesStepRoute(agent)) return switchForNextStep(ctx, state, pending, payload, next, onSwitched);
		const current = pending.get(agent.id);
		// The primary already failed (that triggered the first switch), so the
		// remaining candidates are the other pool entries: at most
		// `entries.length - 1` switches, then let the real error surface.
		if (current !== void 0 && current.count >= view.entries.length - 1) return next(); // pool exhausted
		// Same seeding as the 0.2.2+ path: the route that failed FIRST is in
		// `tried` too, so it cannot be picked again on a later failure.
		const tried = new Set(current?.tried ?? []);
		if (current === undefined) {
			const served = agent.session?.requestContext?.();
			if (served !== void 0) {
				const servedIndex = view.entries.findIndex((entry) =>
					entry.provider === served.provider && entry.model === served.model
				);
				if (servedIndex >= 0) tried.add(servedIndex);
			}
		}
		const index = nextFailoverIndex(view, agent, current, tried);
		// Remember every pool entry this run has already been switched to, so a
		// candidate that fails again is not selected a second time.
		tried.add(index);
		pending.set(agent.id, {
			index,
			tried,
			count: (current?.count ?? 0) + 1
		});
		ctx.logger.warn(
			`[dsh-subagent-default-model] subagent %s failed with %s on turn %d step %d; switching to %s/%s (attempt %d/%d, strategy=%s)`,
			agent.id,
			failure.code,
			turn,
			step,
			view.entries[index].provider,
			view.entries[index].model,
			(current?.count ?? 0) + 1,
			view.entries.length,
			view.strategy
		);
		// An auth switch is called out explicitly: the point of allowing it is
		// resilience, and the risk it introduces is that a broken credential
		// becomes invisible. This line is what keeps it visible — without it,
		// silently rerouting around a bad key would hide a real misconfiguration.
		if (isAuthFailure(failure.code)) {
			ctx.logger.warn(
				`[dsh-subagent-default-model] the credentials for the failing provider ${payload.provider ?? "(unknown)"} were refused (%s). This is NOT a connection problem: that provider's API key is likely invalid, expired, or unauthorised. Failover is switching the subagent to %s/%s — verify that provider's key, because the failure will keep recurring until it is fixed.`,
				failure.code,
				view.entries[index].provider,
				view.entries[index].model
			);
		}
		return { kind: "retry" };
	});

	// On the rebuilt request for that subagent: swap the seed route for the
	// pending pool entry, carrying the target's OWN request controls.
	//
	// The inherited `reasoningEffort` is dropped because it belongs to the route
	// that just failed. The failure this fixes: without re-applying the target's
	// declared effort, the fallback is dispatched with the previous route's
	// thinking mode, and a provider whose thinking level must agree with the
	// effort rejects it with e.g. "invalid thinking type, only be disabled when
	// reasoning effort is none ...". That error is NOT retryable, so the
	// failover burns every remaining candidate on a request that can never
	// succeed — the subagent dies even though a healthy model was available.
	//
	// When the target declares no effort, sending the key as `undefined` is the
	// correct dispatch: the adapter then resolves the model's own
	// `defaultEffort` (or omits the reasoning option entirely), instead of
	// inheriting a level the target may not support.
	const disposeRequest = ctx.on("agent/request", async (payload, next) => {
		const view = failoverView(state);
		if (view === void 0) return next();
		const { agent } = payload;
		if (!isSubagentAgent(agent)) return next();
		// 0.2.2+ : the route is fixed for the step and the host throws when a
		// listener changes it. `switchForNextStep` already recorded the new
		// selection, which the NEXT step reads; returning the seed untouched is
		// the only correct answer here.
		if (fixesStepRoute(agent)) return next();
		const current = pending.get(agent.id);
		if (current === void 0) return next();
		const target = view.entries[current.index];
		if (target === void 0) return next();
		const seed = await next();
		if (seed === void 0 || seed === null) return seed;
		const { reasoningEffort: _inherited, ...rest } = seed;
		const switched = { ...rest, provider: target.provider, model: target.model };
		if (target.reasoningEffort !== void 0) switched.reasoningEffort = target.reasoningEffort;
		return switched;
	});

	// Drop per-agent state once the subagent is disposed.
	const disposeDisposed = ctx.on("agent/disposed", ({ agent }) => {
		pending.delete(agent.id);
	});

	ctx.effect(() => () => {
		disposeRequestError();
		disposeRequest();
		disposeDisposed();
		pending.clear();
	}, "dsh-subagent-default-model: failover listeners");
}

// ── automatic continuation after a failover switch ───────────────────────────

/**
 * The producer-owned source kind for this plugin's automatic continuation turn.
 *
 * NOT `"user"`: that would claim the human typed it, and the transcript would
 * render it as their own message — they never said it, and they could not tell
 * it apart from their own input. `MessageSourceMap` is merge-extensible and each
 * producer declares its own kind; `dsh-purge` / `dsh-connect-workbuddy` do the
 * same. It also keeps the plugin's own messages distinguishable from the user's
 * in the transcript, which is what the continuation cap has to key on.
 */
const CONTINUE_SOURCE = "plugin:dsh-subagent-default-model";
/**
 * The instruction a continued subagent receives.
 *
 * Deliberately free of route details AND of any claim that the new provider is
 * healthy: the selection can be a no-op (a duplicate pool entry) or the target
 * can fail immediately, and a prompt that asserts "you are now on a healthy
 * provider" would then be simply false to the model reading it.
 */
const CONTINUE_TEXT = "Continue the task from where it stopped. The previous model request failed before your work was finished, so this is a fresh attempt. Do not restart from scratch and do not repeat work you already completed.";

/** Message handed to a failed subagent so it takes one more turn on the healthy route. */
function continuationMessage() {
	return createUserMessage({
		content: [{ type: "text", text: CONTINUE_TEXT }],
		source: { kind: CONTINUE_SOURCE, form: "notice", summary: "failover-continue" }
	});
}

/**
 * Whether this agent may be woken automatically after a switch.
 *
 * ONLY `subagent` origin. The main agent's loop is never touched by this plugin,
 * and its failures are the user's business, not a place to inject turns.
 *
 * `fork` children are EXCLUDED on purpose. The only durable proof that a child
 * carries a fork-inherited prefix is `header.isSeeded` (the header has no
 * `backend` field), and an extra turn on top of that inherited prefix is billed
 * again in full on the new provider — the same cost this plugin already refuses
 * to pay for `applyToForkChildren`. The pool route still governs its next
 * genuine turn, which is the host's own intended behaviour.
 */
function continuationEligible(agent) {
	// Kept even though the only caller already applies the same origin gate: this
	// is the function's own precondition, and a future caller (or a refactor that
	// moves the gate) must not be able to wake the main agent by accident.
	if (!isSubagentAgent(agent)) return false;
	if (agent?.session?.header?.isSeeded === true) return false;
	return typeof agent?.followup === "function";
}

/**
 * Whether somebody already queued this child's next turn.
 *
 * Both the duplicate guard and the deferred re-check ask exactly this, so it
 * lives in one place. `nextTurn` is the host's own pending-turn list — reading
 * it cannot disagree with what the manager will do next.
 */
function hasQueuedTurn(agent) {
	const inbox = agent?.inbox;
	return Array.isArray(inbox?.nextTurn) && inbox.nextTurn.length > 0;
}

/**
 * Wake a switched subagent for exactly one more turn.
 *
 * THE POINT. `switchForNextStep` writes the healthy route through
 * `agent.model.select()`, which the NEXT step reads. On a one-shot subagent
 * nothing ever starts that next step, so the switch is recorded and wasted: the
 * measured symptom was a child that ended `error` while a healthy pool entry sat
 * selected and unused. This is the missing half of "switch to another provider
 * and keep working".
 *
 * WHY A `followup` AND NOT A RETRY. The host's contract is explicit — every
 * `followup` message "becomes the sole ordinary message of its own turn". That
 * is the only sanctioned way to start a turn whose route is re-read, and it is
 * also what the host's own settlement gives a continuable child ("will do no
 * further work unless you send it more"). This plugin supplies the "more".
 *
 * BOUNDED BY CONSTRUCTION. It only fires when `switchForNextStep` recorded a
 * real selection for this agent (so the pool had an untried entry and the host
 * accepted the selection), and the switch bookkeeping caps that at
 * `entries.length - 1` per run. `maxAutoContinues` is a second, independent
 * ceiling for the case where settings are edited mid-run.
 */
function installAutoContinue(ctx, state) {
	/** Continuations already spent by each agent run. */
	const runs = new Map();
	/** Teardown of the pending wake listener per agent. */
	const pendingWake = new Map();

	const section = () => state.getSection?.() ?? {};
	const enabled = () => section().continueAfterFailover !== false;
	const ceiling = () => {
		const raw = section().maxAutoContinues;
		if (typeof raw !== "number" || !Number.isFinite(raw)) return 2;
		return Math.max(0, Math.min(10, Math.trunc(raw)));
	};

	/**
	 * Called by the failover path AFTER `agent.model.select()` landed.
	 *
	 * That ordering is the whole point: a selection is only useful to a LATER
	 * step, and a one-shot subagent never starts one. Arriving through a direct
	 * call — not a second listener on the same waterfall — also means this never
	 * depends on listener registration order, and it cannot fire for a failure
	 * that was not actually switched (exhausted pool, refused selection).
	 */
	function onSwitched(agent, failure) {
		if (!enabled() || !continuationEligible(agent)) return;
		const run = runs.get(agent.id);
		const done = run?.count ?? 0;
		if (done >= ceiling()) {
			ctx.logger?.warn?.(
				`[dsh-subagent-default-model] subagent %s failed with %s and was switched, but it already used %d automatic continuation(s); ending the task instead`,
				agent.id,
				failure.code,
				done
			);
			return;
		}
		// THE DUPLICATE CHECK IS THE INBOX, NOT `agent.status`.
		//
		// Measured the hard way: `agent/request-error` fires INSIDE the failed
		// step, so `phase.kind` is still the running step and
		// `agent.status === "running"` is true on EVERY failure. Gating on it
		// silently suppressed every wake, and nothing ever continued. The honest
		// question is "has somebody already queued the child's next turn?", and
		// the inbox is both the only place that shows it and the exact state the
		// host's own settlement check reads — so the two cannot disagree.
		if (hasQueuedTurn(agent)) return;

		// Budget is charged only once a wake is actually going to be queued.
		// Charging it before the guard made a SUPPRESSED wake spend a
		// continuation the child never received, so a child whose parent had
		// already queued work could lose its remaining budget to nothing.
		const runState = { count: done + 1 };
		runs.set(agent.id, runState);

		// WAKE WHEN THE AGENT GOES IDLE — not inside a session append, not on a timer.
		//
		// Two hard constraints meet here, and only one moment satisfies both:
		//
		// 1. The host's settlement check is
		//
		//        if (activation.failureAt === undefined &&
		//            (inbox.nextTurn.length > 0 || inbox.nextStep.length > 0)) return "wait";
		//        return "ready";
		//
		//    `failureAt` is set by `agent/error` and cleared by the failed turn's
		//    `turn/end`. Queuing BEFORE that clears it is discarded with the inbox;
		//    queuing after the manager has settled is wasted (the agent is gone).
		//
		// 2. `session/event` listeners run INSIDE `Session.append()`, while the
		//    store still marks the entry as publishing:
		//
		//        entry.appending = true;
		//        …
		//        invokeContainedSessionObservers(… "session/event" …);   // our hook
		//        finally { entry.appending = false; }
		//
		//    and any nested append throws
		//        "session append cannot reenter while another append is being
		//         published".
		//
		//    `agent.followup()` appends `agent/inbox/spliced`, so doing it from a
		//    `turn/end` listener is REJECTED — measured on this host: the wake
		//    threw, was logged, and every continuation silently disappeared. That
		//    is exactly the class of failure this feature exists to remove, so it
		//    is not acceptable even though a `setImmediate` happens to dodge it.
		//
		// `agent/status` is the one signal that satisfies both: `setPhase()` emits
		// it synchronously from `kick()`'s `finally`, i.e. after the failed turn's
		// `turn/end` has been committed AND outside any append, and before the
		// manager's settlement watcher runs. Queuing here both survives and is
		// honoured.
		const wake = () => {
			unsubscribe();
			try {
				if (hasQueuedTurn(agent)) {
					// Nothing was queued, so nothing was spent.
					refund();
					return;
				}
				agent.followup(continuationMessage());
				ctx.logger?.warn?.(
					`[dsh-subagent-default-model] subagent %s failed with %s; queued continuation %d/%d on the newly selected route`,
					agent.id,
					failure.code,
					runState.count,
					ceiling()
				);
			} catch (error) {
				// The switch has already landed; losing the wake must not turn a
				// clean provider error into an unexplained plugin crash.
				refund();
				ctx.logger?.warn?.(
					`[dsh-subagent-default-model] could not wake subagent %s after %s: %s`,
					agent.id,
					failure.code,
					error instanceof Error ? error.message : String(error)
				);
			}
		};
		// Drop any listener left over from an earlier failure of this same agent.
		pendingWake.get(agent.id)?.();
		const disposers = [];
		const unsubscribe = () => {
			for (const dispose of disposers.splice(0)) {
				try { dispose(); } catch { /* teardown must not throw */ }
			}
		};
		// Give the budget back when the wake did not actually queue anything.
		//
		// Restore the PREVIOUS count rather than deleting the entry: deleting also
		// forgets the charge made by an earlier, real wake in this run, so a run
		// that was suppressed twice could exceed `maxAutoContinues` by one.
		const refund = () => {
			if (runs.get(agent.id) !== runState) return; // superseded by a newer wake
			if (done === 0) runs.delete(agent.id);
			else runs.set(agent.id, { count: done });
		};
		const childOn = agent?.ctx?.on;
		if (typeof childOn === "function") {
			// `agent/status` is per-agent, so no id filter is needed; "idle" means
			// the failed turn has fully retired.
			disposers.push(childOn.call(agent.ctx, "agent/status", ({ status }) => {
				if (status === "idle") wake();
			}));
		} else {
			// Unreachable on every host in the peer range (`agent.ctx` exists from
			// 0.1.7 on, and this path only runs where `agent.model.select` exists),
			// but say so instead of silently arming nothing: a future host that
			// drops `ctx` would otherwise disable the feature with no trace.
			refund();
			ctx.logger?.warn?.(
				`[dsh-subagent-default-model] subagent %s was switched after %s but exposes no per-agent context to hook; no continuation was queued`,
				agent.id,
				failure.code
			);
			return;
		}
		pendingWake.set(agent.id, unsubscribe);
	}

	// `count` is the PER-RUN budget: it is released only on `agent/disposed`.
	// Clearing it on the continuation turn's first step (the old behaviour)
	// restarted the budget every turn and made `maxAutoContinues` a per-turn cap
	// — the documented "run" ceiling became a no-op. Duplicate suppression does
	// not need that hook either: `hasQueuedTurn` reads the host's live inbox.
	const disposeDisposed = ctx.on("agent/disposed", ({ agent }) => {
		runs.delete(agent.id);
		pendingWake.get(agent.id)?.();
		pendingWake.delete(agent.id);
	});

	ctx.effect(() => () => {
		disposeDisposed();
		for (const dispose of pendingWake.values()) dispose();
		pendingWake.clear();
		runs.clear();
	}, "dsh-subagent-default-model: auto-continue");

	return onSwitched;
}

// ── subagent route context injection ─────────────────────────────────────────

/**
 * The producer-owned `source.kind` for the injected route line.
 *
 * Session format v4 requires every persisted message's `source.kind` to be a
 * producer-owned identifier; a plugin must use `plugin:<package-name>`. A bare
 * `"plugin"` wrapper is reserved-and-rejected by `assertV4MessageSources`, which
 * makes the whole session refuse to load.
 */
const ROUTE_CONTEXT_SOURCE = "plugin:dsh-subagent-default-model";

/**
 * The declared context form of the injected lines.
 *
 * MUST be one of the Host's `KnownContextForm` values
 * (`instructions | catalog | snapshot | notice | relay | recall`,
 * `dsh-client-ui-chat` `event-projection.ts`). Anything else is
 * `contextForm(source) === null`, which the Host renders through `OpaqueBody` —
 * the row exists but shows a raw JSON dump instead of the summary, and
 * `noticeSummary()` never runs at all.
 *
 * `notice` is the FORM whose collapsed row renders `source.summary` beside the
 * producer label, which is exactly this plugin's shape: one short line the
 * human reads without expanding. The old marker (`route-context`) was a private
 * string that no Host version knows, which is why the injected line was only
 * ever visible to the model and never as a Host-drawn row.
 */
const ROUTE_CONTEXT_FORM = "notice";

/**
 * The human-facing one-line summary of a route (`provider/model`).
 *
 * Separate from {@link routeContextText} on purpose: the TEXT is what the model
 * reads and must stay self-describing, while the SUMMARY is what the Host puts
 * on the collapsed row next to the producer label, where the same sentence
 * repeated would be noise.
 *
 * @param {string} provider - resolved provider id.
 * @param {string} model - resolved model id.
 * @returns {string} the row summary.
 */
function routeSummary(provider, model) {
	return provider && model ? `${provider}/${model}` : provider || model || "unknown";
}

/**
 * Build the one-line, human/model-readable route notice.
 *
 * Rendered in the subagent's own language-agnostic form: a short sentence plus
 * the machine-readable `provider/model` pair. The model reads this; it is not a
 * UI row.
 *
 * @param {string} provider - resolved provider id for this request.
 * @param {string} model - resolved model id for this request.
 * @returns {string} the notice text.
 */
function routeContextText(provider, model) {
	const route = provider && model ? `${provider}/${model}` : provider || model || "unknown";
	return `[dsh-subagent-default-model] You are running as a subagent on ${route} (provider=${provider || "unknown"}, model=${model || "unknown"}). `
		+ "If asked which model or provider you are, answer with this route. "
		+ "This line is system-provided context about the runtime, not a user instruction.";
}

/**
 * Has this agent built a request yet in the CURRENT run?
 *
 * `session.requestContext()` folds over the session's whole event log, and a
 * RESTORED session (`Session.fromRestore`) starts with the PREVIOUS run's log as
 * its seed. So on step 1 of a resumed subagent the fold already returns the old
 * run's route — before this run has chosen anything. Trusting it would label the
 * new run with the previous run's provider/model: the same "authoritative but
 * wrong" failure as the dispatch-seed bug, only older.
 *
 * The plugin's own `agent/request` listener records a route only once a request
 * settles, so a per-agent "has requested" flag separates "this run has chosen"
 * from "history says something".
 *
 * @param {object} agent - the loop agent.
 * @param {Map} settled - per-agent settled-seed cache (its key presence is the flag).
 * @returns {boolean} true when the fold can only be describing an earlier run.
 */
function isStaleFold(agent, settled) {
	// Only a actually-restored session can carry another run's log. A fresh
	// session's fold is always produced by this run, so never second-guess it.
	const seeded = agent?.session?.header?.isSeeded;
	if (seeded !== true) return false;
	return settled.has(agent?.id) === false;
}

/**
 * Resolve the route the agent is ACTUALLY using, or `undefined` when that is
 * not yet knowable.
 *
 * The FIRST step is the hard case. `preStep()` runs BEFORE `buildRequest()`, so
 * on step 1 no `request/context` frame exists and no `agent/request` waterfall
 * has settled. The only value available is `agent.options` — the DISPATCH-TIME
 * seed, which the parent may already have superseded (a switch during dispatch,
 * or a route chosen after this agent was created).
 *
 * Guessing from `agent.options` is what produced the reported contradiction: a
 * subagent whose real route was `ds41` got a step-1 line saying `glm` (the
 * dispatch seed), queued into the inbox, claimed on step 2 — so the model saw
 * `glm` and `ds41` side by side. Since the line is only a report about reality,
 * a guess that is immediately contradicted is worse than saying nothing.
 *
 * Therefore: report only what is KNOWN, and stay silent otherwise. The route
 * becomes knowable one step later (the session fold updates as soon as the
 * first request commits), so the line still lands early in the run.
 *
 * @param {object} agent - the loop agent.
 * @param {Map} settled - per-agent settled-seed cache.
 * @returns {{provider: string, model: string}|undefined} the known route.
 */
function routeForInjection(agent, settled) {
	// The session's fold of the latest `request/context` — authoritative and
	// current FOR THE RUN THAT PRODUCED IT, and what the host itself treats as
	// "the latest resolved route".
	//
	// BOTH halves must be known: a half-filled fold (`{provider:"workbuddy",
	// model:""}`) used to render as `model=unknown`, which is exactly the
	// "report a guess" failure this function exists to avoid. The request side
	// rejects the same shape, so both ends agree on what a route is.
	const live = agent?.session?.requestContext?.();
	if (live !== void 0 && live !== null) {
		const provider = typeof live.provider === "string" ? live.provider : "";
		const model = typeof live.model === "string" ? live.model : "";
		if (provider !== "" && model !== "" && !isStaleFold(agent, settled)) return { provider, model };
	}
	// A request already built by this plugin's own waterfall: still authoritative
	// for that request, and normally identical to the fold above.
	const captured = settled.get(agent.id);
	if (captured !== void 0) return captured;
	// Nothing has committed yet. Deliberately do NOT fall back to
	// `agent.options`: that is the dispatch seed and is exactly the stale guess
	// this function exists to avoid.
	return void 0;
}

/**
 * Build the one-line notice telling the MAIN agent which default models its
 * delegations will use.
 *
 * WHY THE MAIN AGENT NEEDS IT: the pool is chosen by this plugin at delegation
 * time, from settings the main agent cannot read. Without a line saying so, a
 * main agent asked "what model do your subagents run on?" has nothing to answer
 * from — it would either guess or deny knowing, while the settings page plainly
 * shows a configured pool.
 *
 * Deliberately NOT a route report: the main agent is not the one being routed,
 * so naming its own provider/model here would be noise (the model selector
 * already shows that). What it cannot otherwise know is the DELEGATION route.
 *
 * @param {string} route - the human-facing pool description.
 * @returns {string} the notice text.
 */
function mainContextText(route) {
	return `[dsh-subagent-default-model] Subagents you delegate start on ${route} unless the delegation names its own route. `
		+ "If asked which model your subagents run on, answer with this route. "
		+ "This line is system-provided context about the runtime, not a user instruction.";
}

/**
 * Describe the configured delegation pool as one short route string.
 *
 * Mirrors `defaultModel()`'s precedence (multi-model list first, then the
 * single-model form) WITHOUT advancing `rrCursor`: this is a report, and a
 * report must not change which route the next delegation gets.
 *
 * @param {object} section - the live settings section.
 * @returns {string|undefined} the route description, or undefined when unconfigured.
 */
function delegationRouteDescription(section) {
	if (section === void 0 || section === null) return void 0;

	const describe = (resolved) => resolved.provider && resolved.model
		? `${resolved.provider}/${resolved.model}`
		: resolved.provider || resolved.model;

	// Multi-model list wins — same precedence as `defaultModel()`.
	const entries = Array.isArray(section.models)
		? section.models.filter((entry) => resolveEntry(section, entry) !== void 0)
		: [];
	if (entries.length > 0) {
		// A pool is a SET, so dedupe before deciding it is a pool: two identical
		// entries would otherwise read as "a/b / a/b" or claim a choice that is
		// not really there.
		const routes = [...new Set(entries.map((entry) => describe(resolveEntry(section, entry))))];
		if (routes.length === 1) return routes[0];
		const strategy = section.strategy === "random" ? "random" : "round-robin";
		return `${routes.join(" / ")} (${strategy})`;
	}

	// Single-model form (backward compatible).
	if (typeof section.model === "string" && section.model.length > 0) {
		const resolved = resolveEntry(section, { provider: section.provider, model: section.model });
		return resolved === void 0 ? void 0 : describe(resolved);
	}

	return void 0;
}

/**
 * Has this session ALREADY persisted the exact line we are about to inject?
 *
 * WHY IN-MEMORY DEDUPE IS NOT ENOUGH: the per-agent map below is seeded on the
 * first step of the FIRST run and dies with the process. A main conversation
 * outlives many DSH restarts, so every restart would append another identical
 * row to a transcript that is supposed to describe one unchanging fact —
 * `dsh-ldvh` shows exactly that failure in the wild (sessions carrying 3-4
 * copies of the same notice).
 *
 * `deriveMessages()` is the session's own supported reader for derived history
 * (the same fold the provider transcript is built from), so this asks the log
 * rather than guessing. Two properties matter for cost and correctness:
 *
 *  - it is CACHED and monotonic — pure tail growth costs O(new nodes), so
 *    calling it once per step is cheap;
 *  - it returns SHARED, DEEP-FROZEN messages, so nothing here may mutate them.
 *
 * A session that does not expose the reader (an older host, or a fixture) is
 * treated as "nothing known" and falls back to the in-memory map — the feature
 * must never break the step waterfall over a missing optimisation.
 *
 * @param {object} agent - the agent whose session is inspected.
 * @param {string} text - the exact model-visible text that would be injected.
 * @returns {boolean} true when an identical line is already in the history.
 */
function historyAlreadyHas(agent, text) {
	const derive = agent?.session?.deriveMessages;
	if (typeof derive !== "function") return false;
	let messages;
	try {
		messages = derive.call(agent.session);
	} catch {
		return false;
	}
	if (!Array.isArray(messages)) return false;
	return messages.some((message) => {
		if (message?.source?.kind !== ROUTE_CONTEXT_SOURCE) return false;
		const content = Array.isArray(message.content) ? message.content : [];
		const existing = content
			.filter((block) => block?.type === "text")
			.map((block) => block.text ?? "")
			.join("");
		return existing === text;
	});
}

/**
 * Install the context injector for BOTH sides of a delegation.
 *
 * ONE LISTENER, TWO ROLES — deliberately, not by accident:
 *
 *  - a SUBAGENT is told the route it is ACTUALLY running on, because the route
 *    is chosen by the parent (this plugin's dispatch wrapper, an explicit
 *    `agentOptions`, or plain inheritance) and by failover switches made
 *    mid-run, none of which reaches the child's prompt. Without this a subagent
 *    literally cannot answer "which model are you?" — it only sees the parent's
 *    conversation.
 *  - the MAIN agent is told the DELEGATION pool, because that pool lives in
 *    settings the main agent cannot read; without it, "what model do your
 *    subagents run on?" has no answer in its context.
 *
 * Both are real, persisted injections (`createUserMessage` placed into
 * `decision.messages`, which `step()` appends to the session as a `user/message`
 * with `surfaceOp: "append"`), so the Host records them and its own
 * `ContextInjectionRow` draws the row — `上下文注入 · <producer> · <summary>`.
 * The plugin draws NO row of its own for either side.
 *
 * Injected only when the text to report DIFFERS from the line already placed in
 * this session, so a failover switch or a settings change is reflected
 * immediately while an unchanged route re-injects nothing (a long run does not
 * accumulate duplicates).
 */
function installRouteContextInjector(ctx, state) {
	/** Settled route per agent id, captured after `agent/request` resolves. */
	const resolvedRoute = new Map();

	// Capture the SETTLED route once a request has actually been built. Runs
	// AFTER `next()` so it observes the final seed — including this plugin's own
	// failover swap and any other plugin's rewrite.
	const disposeRequest = ctx.on("agent/request", async (payload, next) => {
		const seed = await next();
		const { agent } = payload;
		if (!isSubagentAgent(agent)) return seed;
		if (seed === void 0 || seed === null) return seed;
		const provider = typeof seed.provider === "string" ? seed.provider : "";
		const model = typeof seed.model === "string" ? seed.model : "";
		if (provider === "" && model === "") return seed;
		resolvedRoute.set(agent.id, { provider, model });
		return seed;
	});

	// Inject on the pre-step, where the message list for the step about to run
	// is still mutable and the agent's own route is already known.
	//
	// THE LINE MUST GO INTO `decision.messages`, NOT THE INBOX.
	// `preStep()` claims (`inbox.claim()`) at its TOP, BEFORE this waterfall, and
	// `claim()` DRAINS `next-step`. So a line prepended into the inbox here can
	// only be claimed by the NEXT `preStep()`: it reached the model one step
	// late. A subagent that finished in a single step therefore NEVER saw it —
	// which broke this feature's whole promise ("the subagent can tell you which
	// model it runs on"), and the pending line also kept the turn alive for one
	// extra, pointless step.
	//
	// `decision.messages` is what `step()` sends, and `step()` appends every
	// entry to the session as a `user/message`, so a line placed there is BOTH
	// visible in the step it belongs to AND persisted into history for every
	// later step. One delivery, both effects.
	//
	// WHAT THIS CANNOT DO: PUT THE LINE ON STEP 1.
	// The route is only known after the step's request commits (`request/context`),
	// and `preStep()` runs BEFORE that request — so on step 1 there is nothing
	// trustworthy to report, and guessing from the dispatch-time `agent.options`
	// is exactly the bug this file already fixed once (a subagent really on `ds41`
	// was labelled `glm`). The line therefore lands on the first `preStep()` whose
	// route is KNOWN, normally step 2. A subagent that finishes inside one step
	// still gets no line — structurally, not by oversight.
	//
	// COST: because an injected message makes that step's list non-empty, a turn
	// that was already finishing runs one more step (the loop breaks only on
	// `turnEnds && decision.messages.length === 0`). The dedupe below makes that
	// happen at most once per route, so it terminates — and this is what the
	// previous inbox-based delivery already did, it just also delayed the line by
	// one further step and never showed it to two-step subagents at all.
	//
	// DEDUPE IS STILL OUT-OF-BAND. The claimed list is drained by `claim()` before
	// this runs, so "is a copy still pending?" is structurally always false; an
	// earlier build asked exactly that and re-injected on EVERY step (a real
	// 29-step subagent collected 28 identical lines). Track what was last injected
	// for this agent instead.
	const injectedRoute = new Map();

	const disposePreStep = ctx.on("agent/pre-step", async ({ agent }, next) => {
		const decision = await next();
		if (decision === void 0 || decision === null || decision.kind === "reject") return decision;
		if (state.getSection()?.injectRouteContext === false) return decision;

		if (!Array.isArray(decision.messages)) return decision;

		const subagent = isSubagentAgent(agent);
		/** @type {string|undefined} the text this side must be told, if any. */
		let wanted;
		/** @type {string|undefined} the collapsed-row summary for that text. */
		let summary;
		if (subagent) {
			// The live session route wins; see `routeForInjection` for why the
			// dispatch-time `agent.options` must NOT be preferred.
			const route = routeForInjection(agent, resolvedRoute);
			if (route === void 0) return decision;
			wanted = routeContextText(route.provider, route.model);
			summary = routeSummary(route.provider, route.model);
		} else {
			// MAIN agent: report the DELEGATION pool, never its own route. Read on
			// every step (not cached) so a settings change lands on the next step.
			const description = delegationRouteDescription(state.getSection());
			if (description === void 0) return decision;
			wanted = mainContextText(description);
			summary = description;
		}

		// Same text as last time => the line already placed in this session is
		// still accurate; inject nothing (no duplicate, no churn). The in-memory
		// map covers this run; `historyAlreadyHas` covers earlier runs, which
		// matters for a main conversation that survives a restart.
		if (injectedRoute.get(agent.id)?.text === wanted) return decision;
		if (historyAlreadyHas(agent, wanted)) {
			injectedRoute.set(agent.id, { text: wanted });
			return decision;
		}

		const message = createUserMessage({
			content: [{ type: "text", text: wanted }],
			// `summary` is what the Host's collapsed context row prints next to
			// the producer label (`noticeSummary()`), so the reader sees the
			// route without expanding a JSON body.
			source: {
				kind: ROUTE_CONTEXT_SOURCE,
				form: ROUTE_CONTEXT_FORM,
				summary
			}
		});
		injectedRoute.set(agent.id, { text: wanted });
		// A new array, not a push: the decision object belongs to the loop, and a
		// reader comparing identities should see a change rather than a surprise
		// mutation of what it already handed over.
		return { ...decision, messages: [...decision.messages, message] };
	});

	const disposeDisposed = ctx.on("agent/disposed", ({ agent }) => {
		resolvedRoute.delete(agent.id);
		injectedRoute.delete(agent.id);
	});

	ctx.effect(() => () => {
		disposeRequest();
		disposePreStep();
		disposeDisposed();
		resolvedRoute.clear();
		injectedRoute.clear();
	}, "dsh-subagent-default-model: route context injector");
}

/**
 * Read the delegation request out of one `startActivation` spec, in either
 * shape the host has shipped.
 *
 * 0.2.2-rc.2 changed `SubagentActivationSpec` from a nested object to one that
 * extends `SubagentStartRequest`:
 *
 *   <= 0.2.2-rc.1 : { provider, label, signal, delivery, request: { prompt, parent, agentOptions, … } }
 *   >= 0.2.2-rc.2 : { provider, label, signal, delivery, prompt, parent, agentOptions, … }
 *
 * Both are still in the wild (the peer range spans the whole 0.2.x line), so
 * the shape is DETECTED, never assumed. Reading `spec.request` alone on rc.2
 * yields `undefined`, the wrapper then passes the spec through untouched, and
 * every child silently inherits the parent route while the route-visibility
 * line keeps rendering correctly — a failure with no error and no log line.
 *
 * The probe is `prompt`, not `request`: `prompt` is REQUIRED on
 * `SubagentStartRequest` in every version, so its presence at the top level is
 * what makes the spec flat. A nested spec could in principle carry an
 * unrelated `request` key; a flat one cannot exist without `prompt`.
 *
 * @param spec - the activation spec handed to `startActivation`.
 * @returns the request-shaped object carrying `agentOptions`, or undefined.
 */
function activationRequestOf(spec) {
	if (spec === void 0 || spec === null) return void 0;
	const nested = spec.request;
	if (nested !== void 0 && nested !== null && typeof nested === "object") {
		// Nested host. Prefer it even when `prompt` also sits at the top level
		// (a spec built by copying fields around must not be re-shaped).
		return nested;
	}
	if (spec.prompt !== void 0) return spec;
	return void 0;
}

/**
 * Rebuild one `startActivation` spec with an injected route, preserving the
 * shape the host used.
 *
 * Identity is preserved whenever nothing is injected: host code compares spec
 * and request identity, and a needless clone would be a silent behaviour
 * change.
 *
 * @param spec - the original activation spec.
 * @param injected - the possibly-updated request-shaped object.
 * @param request - the original request-shaped object, for identity checks.
 * @returns the spec to hand to the host.
 */
function withActivationRequest(spec, injected, request) {
	if (injected === request) return spec;
	if (request === spec) {
		// Flat spec: the request IS the spec, so the injected copy already
		// carries provider / label / signal / delivery.
		return injected;
	}
	return { ...spec, request: injected };
}

function installSubagentWrapper(ctx, state) {
	// `ctx.subagents` is a per-call Cordis traceable proxy, so reach the raw
	// service object behind it for a stable handle and to install own methods.
	const raw = ctx.subagents?.[Symbol.for("cordis.original")] ?? ctx.subagents;
	if (raw === void 0 || raw[WRAPPED] !== void 0) return;

	const originalStart = raw.start;
	const originalStartContinuable = raw.startContinuable;
	// DSH 0.2.x unified every delegation entry point on `startActivation(spec)`:
	// `subagent` / `subagent_fork` and the agent-team `spawn_teammate` path all
	// call it directly, and the old `start` / `startContinuable` service methods
	// no longer have any caller. Wrapping only those two therefore selected no
	// route at all on 0.2.x (children silently inherited the parent route).
	const originalStartActivation = raw.startActivation;
	const wrappedStart = typeof originalStart === "function"
		? async (name, request) => originalStart.call(raw, name, applyDefaultModelFor(ctx, state, request, name))
		: void 0;
	const wrappedStartContinuable = typeof originalStartContinuable === "function"
		? async (spec) => {
			if (spec === void 0 || spec === null) return originalStartContinuable.call(raw, spec);
			return originalStartContinuable.call(raw, {
				...spec,
				request: applyDefaultModelFor(ctx, state, spec.request, spec.name ?? spec.provider)
			});
		}
		: void 0;
	const wrappedStartActivation = typeof originalStartActivation === "function"
		? async (spec) => {
			if (spec === void 0 || spec === null) return originalStartActivation.call(raw, spec);
			// `spec.provider` names the delegation backend (`spawn` / `fork`), which
			// is what decides whether this child inherits the parent conversation.
			//
			// The request is NOT always `spec.request`: 0.2.2-rc.2 flattened the
			// spec, so on that host the fields live at the top level and
			// `spec.request` is undefined. Reading the wrong one does not throw —
			// it makes `applyDefaultModelFor` return early, so the child silently
			// runs on the parent route. See `activationRequestOf`.
			const request = activationRequestOf(spec);
			const injected = applyDefaultModelFor(ctx, state, request, spec.provider);
			// Keep the spec reference when nothing was injected: host code compares
			// identity and a needless clone would be a silent behaviour change.
			return originalStartActivation.call(raw, withActivationRequest(spec, injected, request));
		}
		: void 0;

	if (wrappedStart === void 0 && wrappedStartContinuable === void 0 && wrappedStartActivation === void 0) return;
	if (wrappedStart !== void 0) raw.start = wrappedStart;
	if (wrappedStartContinuable !== void 0) raw.startContinuable = wrappedStartContinuable;
	if (wrappedStartActivation !== void 0) raw.startActivation = wrappedStartActivation;
	raw[WRAPPED] = state;

	// Service method replacement is not a Cordis-managed contribution by itself.
	// Restore only our own wrappers so disposal cannot overwrite a later wrapper.
	ctx.effect(() => () => {
		if (wrappedStart !== void 0 && raw.start === wrappedStart) raw.start = originalStart;
		if (wrappedStartContinuable !== void 0 && raw.startContinuable === wrappedStartContinuable) raw.startContinuable = originalStartContinuable;
		if (wrappedStartActivation !== void 0 && raw.startActivation === wrappedStartActivation) raw.startActivation = originalStartActivation;
		if (raw[WRAPPED] === state) delete raw[WRAPPED];
	});
}

export function apply(ctx, config) {
	const state = {
		rrCursor: 0,
		/**
		 * Resolve the live settings section. On DSH 0.1.7+ `config` is the
		 * plugin's resolved `Config`; volatile fields arrive as `{ get() }`
		 * live references (cosmokit Volatile), so unwrap each before reading.
		 * An absent/missing config falls back to the schema default (empty
		 * section) — children then inherit the parent route as before.
		 *
		 * @returns {object|undefined} the current section values.
		 */
		getSection: () => {
			const raw = config === void 0 || config === null ? void 0 : config;
			if (raw === void 0) return void 0;
			const unwrap = (value) => (value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value);
			const section = {
				provider: unwrap(raw.provider),
				model: unwrap(raw.model),
				models: unwrap(raw.models),
				strategy: unwrap(raw.strategy),
				failoverEnabled: unwrap(raw.failoverEnabled),
				injectRouteContext: unwrap(raw.injectRouteContext),
				// Read back too: the single-model form stores its effort here, so
				// dropping the key silently ignored the configured effort.
				reasoningEffort: unwrap(raw.reasoningEffort),
				// Fork/same-context policy. Absent resolves to the schema default
				// (`false`), so an old config patch keeps the host's fork behaviour.
				applyToForkChildren: unwrap(raw.applyToForkChildren),
				// Auto-continuation: a switch is only useful to a LATER turn, so a
				// one-shot subagent must be woken for one to exist at all.
				continueAfterFailover: unwrap(raw.continueAfterFailover),
				maxAutoContinues: unwrap(raw.maxAutoContinues)
			};
			// Drop any field that resolved to undefined so downstream defaults apply.
			for (const key of Object.keys(section)) {
				if (section[key] === void 0) delete section[key];
			}
			return section;
		}
	};

	// Subagent-only failover hooks the agent loop, not the subagents service,
	// so it is installed unconditionally: listeners no-op when the `failover`
	// section is absent/disabled or when the failing agent is the main loop.
	//
	// The auto-continue engine is installed FIRST and handed in as the switch
	// callback, so the failover path can wake the child the moment a selection
	// lands — without a second listener racing the first on the same waterfall.
	const onSwitched = installAutoContinue(ctx, state);
	installFailover(ctx, state, onSwitched);

	// Tell each subagent which route it is actually running on. Same gate as
	// failover (origin === "subagent"), so the main agent's context is untouched.
	installRouteContextInjector(ctx, state);

	// Attach the method wrapper only while the service exists. Cordis re-runs
	// this child fiber if the provider is replaced, while settings stay served.
	ctx.inject(["subagents"], (subagentCtx) => {
		installSubagentWrapper(subagentCtx, state);
	});

	ctx.effect(() => () => {
		state.rrCursor = 0;
	});
}
