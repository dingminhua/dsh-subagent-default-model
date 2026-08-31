import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

/**
 * dsh-subagent-default-model — default model(s) for subagent delegations.
 *
 * Host-plane plugin. It registers the shared `subagent-default-model` settings
 * section (`~/.dsh/settings.yaml`) and wraps the host `ctx.subagents` service
 * (`start` / `startContinuable`), so any delegation whose request carries no
 * explicit `agentOptions` (the stock `subagent` / `subagent_fork` tools and
 * every other tool that omits model/provider) creates the child with a
 * configured default model. Explicit per-call overrides (e.g.
 * `subagent_with_model`) always win; an absent or incomplete settings section
 * keeps the historical behavior: children inherit the parent session route.
 *
 * Multiple models are supported: the `models` list is picked from on every
 * delegation either round-robin (default) or at random (`strategy`), so a
 * batch of parallel subagents spreads across the configured models. The
 * selection is re-evaluated on every call (settings hot-reload + live picker
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
// Do not hard-inject `subagents` at the plugin root: DSH 0.1.2 may mount that
// service after this row. The settings section must become available
// independently; `apply()` attaches the service wrapper through `ctx.inject()`.

/** Settings namespace: default model route for subagent runs without an explicit `agentOptions`. */
const SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace("subagent-default-model");
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
const SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA = z.object({
	provider: z.string(),
	model: z.string(),
	models: z.array(MODEL_ENTRY).default([]),
	strategy: z.union([z.const("round-robin"), z.const("random")]).default("round-robin"),
	failoverEnabled: z.boolean().default(true)
}).default({});

/** State retained on the raw host service while this plugin fiber is active. */
const WRAPPED = Symbol.for("dsh-subagent-default-model.wrapped");

// ── subagent-only error failover ─────────────────────────────────────────────

/**
 * Failure codes that count as "connection failed" (rate limit, quota, server /
 * transport errors, empty responses). Switching on these is safe because a
 * different model/provider may well succeed where the primary just failed.
 */
const FAILOVER_TRIGGER_CODES = ["RATE_LIMIT", "QUOTA", "SERVER", "TIMEOUT", "TRANSPORT", "EMPTY_RESPONSE"];

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
	const section = state.settingsSource?.();
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

/** Inject the default model into one delegation request unless it already names one. */
function applyDefaultModel(state, request) {
	if (request === void 0 || request === null) return request;
	if (request.agentOptions !== void 0) return request;
	const model = defaultModel(state);
	if (model === void 0) return request;
	return { ...request, agentOptions: model };
}

// ── subagent-only error failover ─────────────────────────────────────────────

/** Read the live failover view: the `models` list as the switch pool and the strategy. */
function failoverView(state) {
	const section = state.settingsSource?.();
	if (section === void 0 || section === null) return void 0;
	if (section.failoverEnabled === false) return void 0;
	const entries = Array.isArray(section.models)
		? section.models.map((entry) => resolveEntry(section, entry)).filter((entry) => entry !== void 0)
		: [];
	// A pool of <2 models has nothing to switch to; keep the parent route.
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
 *   around the list (the "queue").
 * - random: any entry, without checking whether it was used before — a random
 *   pick may repeat the failing model, which is fine by design (simplest).
 */
function nextFailoverIndex(view, agent, current) {
	const { entries, strategy } = view;
	if (strategy === "random") {
		return Math.floor(Math.random() * entries.length);
	}
	if (current !== void 0) return (current.index + 1) % entries.length;
	// First failure: locate the served route in the pool and move to the next.
	const served = agent.session?.requestContext?.();
	const found = served === void 0 ? -1 : entries.findIndex((entry) =>
		entry.provider === served.provider && entry.model === served.model
	);
	return found < 0 ? 0 : (found + 1) % entries.length;
}

/**
 * Install the subagent-only failover waterfalls. Both listeners no-op for the
 * main agent (origin gate) and for subagents whose failure code is not a
 * connection failure, so a broken subagent primary is re-tried on the next
 * pool model without ever touching the parent loop. State is keyed per
 * subagent run (`agent.id`) and cleaned on `agent/disposed`, so a persistently
 * broken primary is not re-tried on every step of the same run.
 */
function installFailover(ctx, state) {
	const pending = new Map();

	// After a model failure on a subagent loop: advance the pool index and ask
	// the loop to rebuild the request (`{ kind: "retry" }`). When every pool
	// entry has been tried, let the real error surface untouched.
	const disposeRequestError = ctx.on("agent/request-error", (payload, next) => {
		const view = failoverView(state);
		if (view === void 0) return next();
		const { agent, turn, step, failure, signal } = payload;
		if (signal?.aborted) return next();
		if (!isSubagentAgent(agent)) return next();
		if (failure === void 0 || !FAILOVER_TRIGGER_CODES.includes(failure.code)) return next();
		const current = pending.get(agent.id);
		// The primary already failed (that triggered the first switch), so the
		// remaining candidates are the other pool entries: at most
		// `entries.length - 1` switches, then let the real error surface.
		if (current !== void 0 && current.count >= view.entries.length - 1) return next(); // pool exhausted
		const index = nextFailoverIndex(view, agent, current);
		pending.set(agent.id, {
			index,
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
		return { kind: "retry" };
	});

	// On the rebuilt request for that subagent: swap the seed route for the
	// pending pool entry. Inherited reasoningEffort is dropped on a provider
	// switch (the fallback provider may not support it).
	const disposeRequest = ctx.on("agent/request", async (payload, next) => {
		const view = failoverView(state);
		if (view === void 0) return next();
		const { agent } = payload;
		if (!isSubagentAgent(agent)) return next();
		const current = pending.get(agent.id);
		if (current === void 0) return next();
		const target = view.entries[current.index];
		if (target === void 0) return next();
		const seed = await next();
		if (seed === void 0 || seed === null) return seed;
		const { reasoningEffort: _inherited, ...rest } = seed;
		return { ...rest, provider: target.provider, model: target.model };
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

function installSubagentWrapper(ctx, state) {
	// `ctx.subagents` is a per-call Cordis traceable proxy, so reach the raw
	// service object behind it for a stable handle and to install own methods.
	const raw = ctx.subagents?.[Symbol.for("cordis.original")] ?? ctx.subagents;
	if (raw === void 0 || raw[WRAPPED] !== void 0) return;

	const originalStart = raw.start;
	const originalStartContinuable = raw.startContinuable;
	const wrappedStart = typeof originalStart === "function"
		? async (name, request) => originalStart.call(raw, name, applyDefaultModel(state, request))
		: void 0;
	const wrappedStartContinuable = typeof originalStartContinuable === "function"
		? async (spec) => {
			if (spec === void 0 || spec === null) return originalStartContinuable.call(raw, spec);
			return originalStartContinuable.call(raw, {
				...spec,
				request: applyDefaultModel(state, spec.request)
			});
		}
		: void 0;

	if (wrappedStart === void 0 && wrappedStartContinuable === void 0) return;
	if (wrappedStart !== void 0) raw.start = wrappedStart;
	if (wrappedStartContinuable !== void 0) raw.startContinuable = wrappedStartContinuable;
	raw[WRAPPED] = state;

	// Service method replacement is not a Cordis-managed contribution by itself.
	// Restore only our own wrappers so disposal cannot overwrite a later wrapper.
	ctx.effect(() => () => {
		if (wrappedStart !== void 0 && raw.start === wrappedStart) raw.start = originalStart;
		if (wrappedStartContinuable !== void 0 && raw.startContinuable === wrappedStartContinuable) raw.startContinuable = originalStartContinuable;
		if (raw[WRAPPED] === state) delete raw[WRAPPED];
	});
}

export function apply(ctx) {
	const state = {
		settingsSource: void 0,
		rrCursor: 0
	};

	// Register settings independently from the `subagents` service lifecycle.
	// DSH 0.1.2 can mount that service later or in a different service wave; a
	// root-level hard inject would otherwise keep this whole plugin waiting and
	// hide its settings card even though the Client half is already registered.
	installSettingsSection(ctx, SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, {}, {
		setSource: (current) => {
			state.settingsSource = current;
		},
		onChange: () => {}
	});

	// Subagent-only failover hooks the agent loop, not the subagents service,
	// so it is installed unconditionally: listeners no-op when the `failover`
	// section is absent/disabled or when the failing agent is the main loop.
	installFailover(ctx, state);

	// Attach the method wrapper only while the service exists. Cordis re-runs
	// this child fiber if the provider is replaced, while settings stay served.
	ctx.inject(["subagents"], (subagentCtx) => {
		installSubagentWrapper(subagentCtx, state);
	});

	ctx.effect(() => () => {
		state.settingsSource = void 0;
		state.rrCursor = 0;
	});
}
