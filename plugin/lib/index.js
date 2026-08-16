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
		model: z.string()
	})
]);
/** Schema of the `subagent-default-model` settings section; an absent section keeps inheriting the parent route. */
const SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA = z.object({
	provider: z.string(),
	model: z.string(),
	models: z.array(MODEL_ENTRY).default([]),
	strategy: z.union([z.const("round-robin"), z.const("random")]).default("round-robin")
}).default({});

/** Marker that the host subagents service has already been wrapped by this plugin. */
const WRAPPED = Symbol("dsh-subagent-default-model.wrapped");

/** Live source thunk installed by the settings seam (host singleton). */
let settingsSource;

/** Round-robin cursor, advanced on every round-robin pick. */
let rrCursor = 0;

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
		return { provider: entry.provider, model: entry.model };
	}
	return void 0;
}

/** Pick the next default model from the live settings section, or undefined to inherit the parent route. */
function defaultModel() {
	const section = settingsSource?.();
	if (section === void 0 || section === null) return void 0;

	// Multi-model list wins; pick per strategy.
	const entries = Array.isArray(section.models) ? section.models.filter((entry) => resolveEntry(section, entry) !== void 0) : [];
	if (entries.length > 0) {
		const picked = section.strategy === "random"
			? entries[Math.floor(Math.random() * entries.length)]
			: entries[rrCursor++ % entries.length];
		return resolveEntry(section, picked);
	}

	// Single-model form (backward compatible).
	if (typeof section.model === "string" && section.model.length > 0) {
		if (typeof section.provider !== "string" || section.provider.length === 0) return void 0;
		return { provider: section.provider, model: section.model };
	}

	return void 0;
}

/** Inject the default model into one delegation request unless it already names one. */
function applyDefaultModel(request) {
	if (request === void 0 || request === null) return request;
	if (request.agentOptions !== void 0) return request;
	const model = defaultModel();
	if (model === void 0) return request;
	return { ...request, agentOptions: model };
}

export function apply(ctx) {
	// Register the shared `subagent-default-model` settings section. The seam
	// defers to the settings service becoming ready via `ctx.inject`, so this
	// wiring is safe on any plane and needs no synchronous `ctx.get("settings")`.
	installSettingsSection(ctx, SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, {}, {
		setSource: (current) => {
			settingsSource = current;
		},
		onChange: () => {}
	});

	// Wrap the host subagents service once. `ctx.subagents` is a per-call cordis
	// traceable proxy, so reach the raw service object behind it for a stable
	// handle and to install the wrappers as own methods.
	const raw = ctx.subagents?.[Symbol.for("cordis.original")] ?? ctx.subagents;
	if (raw === void 0 || raw[WRAPPED]) return;
	raw[WRAPPED] = true;

	const originalStart = raw.start.bind(raw);
	raw.start = async (name, request) => originalStart(name, applyDefaultModel(request));

	const originalStartContinuable = raw.startContinuable.bind(raw);
	raw.startContinuable = async (spec) => {
		if (spec === void 0 || spec === null) return originalStartContinuable(spec);
		return originalStartContinuable({
			...spec,
			request: applyDefaultModel(spec.request)
		});
	};
}
