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
 */

export const name = "dsh-subagent-default-model";
export const inject = ["subagents"];

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
	strategy: z.union([z.const("round-robin"), z.const("random")]).default("round-robin")
}).default({});

/** State retained on the raw host service while this plugin fiber is active. */
const WRAPPED = Symbol.for("dsh-subagent-default-model.wrapped");

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

export function apply(ctx) {
	const state = {
		settingsSource: void 0,
		rrCursor: 0
	};

	// The settings seam owns its own injected lifecycle and provides a live
	// source thunk. Register it unconditionally so the web settings row
	// (`subagent-default-model` namespace) is available even when the host
	// `subagents` service is not yet mounted or a previous fiber already wrapped
	// it — the service-method guard below must never gate settings registration.
	installSettingsSection(ctx, SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, {}, {
		setSource: (current) => {
			state.settingsSource = current;
		},
		onChange: () => {}
	});

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
		state.settingsSource = void 0;
		state.rrCursor = 0;
	});
}
