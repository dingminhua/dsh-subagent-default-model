import assert from "node:assert/strict";
import { deepEqual } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// ── Load the browser client bundle in a Node sandbox ──────────────────────
// client.js is a browser IIFE (`window.__ModuleLoader__.load({ id, factory })`).
// We provide a fake window that captures the module, then invoke the factory
// with stubbed `require` and drive `apply(ctx)` with a fake context. This tests
// the real client code — specifically the trajectory definition registered for
// `request/context` frames — without needing a browser.

const clientSource = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

let capturedModule = null;
const sandbox = {
	window: {
		__ModuleLoader__: {
			load(module) {
				capturedModule = module;
			}
		}
	},
	console
};
vm.runInNewContext(clientSource, sandbox, { filename: "client.js" });

function factoryRequire(id) {
	if (id === "react") return {};
	if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Toast: function Toast() {} };
	throw new Error(`unexpected require: ${id}`);
}

function makeCtx(overrides = {}) {
	const registrations = [];
	const slotRegistrations = [];
	const dictionaries = {};
	const t =
		overrides.t ??
		function (key) {
			return (dictionaries.zh ?? {})[key] ?? key;
		};
	const remoteSession = overrides.remoteSession ?? {
		async modelCatalog() {
			return { ok: true, value: { groups: [{ id: "mock", models: [{ id: "deepseek-v4-pro" }] }] } };
		}
	};
	const ctx = {
		get(name) {
			if (name === "remote.session") return remoteSession;
			return undefined;
		},
		locale: {
			register(ns, lang, dict) {
				dictionaries[lang] = { ...(dictionaries[lang] ?? {}), ...dict };
			},
			bind() {
				return t;
			}
		},
		settingsScope: {
			bind() {
				return { get: async () => ({}), set: async () => {} };
			},
			describe() {
				return { load: async () => {} };
			}
		},
		slots: {
			inject(name, callback) {
				slotRegistrations.push({ name, value: callback() });
			},
			register(options, component) {
				return { options, component };
			}
		},
		uiConversation: {
			events: {
				register(definition) {
					registrations.push(definition);
				}
			}
		},
		...overrides.ctx
	};
	return { ctx, registrations, slotRegistrations, dictionaries, remoteSession };
}

function trajectoryDefinition() {
	const { ctx, registrations } = makeCtx();
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	const definition = registrations.find((d) => d.kind === "trajectory-subagent-model");
	assert.ok(definition, "expected a trajectory-subagent-model definition to be registered");
	return definition;
}

function chatDefinition() {
	const { ctx, registrations } = makeCtx();
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	const definition = registrations.find((d) => d.kind === "chat-subagent-model");
	assert.ok(definition, "expected a chat-subagent-model definition to be registered");
	return definition;
}

test("client registers the subagent-default-model settings card and loads the model catalog", async () => {
	const { ctx, slotRegistrations } = makeCtx();
	const { apply, inject } = capturedModule.factory(factoryRequire);
	assert.deepEqual(Array.from(inject), ["slots", "locale", "settingsScope", "remote", "remote.session", "uiConversation"]);
	apply(ctx);
	assert.equal(slotRegistrations.length, 1);
	assert.equal(slotRegistrations[0].name, "settings.plugin.item");
	assert.equal(slotRegistrations[0].value.options.key, "subagent-default-model");
	const props = slotRegistrations[0].value.options.inject();
	const groups = await props.loadCatalog();
	assert.equal(groups.length, 1);
	assert.equal(groups[0].id, "mock");
});

test("client registers a trajectory-subagent-model definition", () => {
	const definition = trajectoryDefinition();
	assert.equal(definition.target, "trajectory");
	assert.equal(typeof definition.match, "function");
	assert.equal(typeof definition.start, "function");
	assert.equal(typeof definition.update, "function");
	assert.equal(typeof definition.buildViewNode, "function");
});

test("client locales include the trajectory model label (zh/en)", () => {
	const { ctx, dictionaries } = makeCtx();
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	assert.equal(dictionaries.zh["row.trajectoryModel"], "当前供应商/模型");
	assert.equal(dictionaries.en["row.trajectoryModel"], "Current provider/model");
});

test("match only claims request/context frames", () => {
	const definition = trajectoryDefinition();
	const claimed = definition.match({ type: "request/context", seq: 42 });
	deepEqual(claimed, { id: "42", role: "start" });
	assert.equal(definition.match({ type: "assistant/message", seq: 43 }), null);
	assert.equal(definition.match({ type: "user/message", seq: 44 }), null);
	assert.equal(definition.match({ type: "request/header", seq: 45 }), null);
});

test("start builds a context node labeled with provider/model (zh)", () => {
	const definition = trajectoryDefinition();
	const event = {
		type: "request/context",
		seq: 7,
		time: 1000,
		data: { provider: "deepseek-official", model: "deepseek-v4-flash" }
	};
	const state = definition.start(undefined, { event });
	assert.equal(state.kind, "context");
	assert.equal(state.seq, 7);
	assert.equal(state.time, 1000);
	assert.equal(state.content[0].type, "text");
	assert.match(state.content[0].text, /当前供应商\/模型/);
	assert.match(state.content[0].text, /deepseek-official/);
	assert.match(state.content[0].text, /deepseek-v4-flash/);
	assert.equal(state.source.kind, "plugin");
});

test("start labels the model with the English locale when bound to en", () => {
	const { ctx, registrations } = makeCtx({
		t(key) {
			return { "row.trajectoryModel": "Current provider/model" }[key] ?? key;
		}
	});
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	const definition = registrations.find((d) => d.kind === "trajectory-subagent-model");
	assert.ok(definition);
	const state = definition.start(undefined, {
		event: {
			type: "request/context",
			seq: 8,
			time: 2000,
			data: { provider: "p1", model: "m1" }
		}
	});
	assert.match(state.content[0].text, /Current provider\/model/);
	assert.match(state.content[0].text, /p1/);
});

test("update is a passthrough and buildViewNode emits a trajectory node", () => {
	const definition = trajectoryDefinition();
	const state = {
		kind: "context",
		seq: 7,
		time: 1000,
		content: [{ type: "text", text: "当前供应商/模型：deepseek-official/deepseek-v4-flash" }],
		source: { kind: "plugin", plugin: "dsh-subagent-default-model" }
	};
	assert.equal(definition.update({ state }), state);

	const node = definition.buildViewNode({
		key: "k",
		kind: "trajectory-subagent-model",
		id: "7",
		start: { location: { kind: "unresolved" } },
		state
	});
	assert.equal(node.target, "trajectory");
	assert.equal(node.anchorSeq, 7);
	assert.equal(node.data.kind, "node");
	assert.equal(node.data.node.kind, "context");
	assert.equal(node.data.node.seq, 7);
});

test("buildViewNode returns null when no state has been started", () => {
	const definition = trajectoryDefinition();
	assert.equal(definition.buildViewNode({ state: undefined }), null);
});

test("applying the client never registers the trajectory definition when uiConversation is unavailable", () => {
	const { ctx } = makeCtx();
	delete ctx.uiConversation;
	const { apply } = capturedModule.factory(factoryRequire);
	assert.doesNotThrow(() => apply(ctx));
});

// ── chat view definition (target:"chat") ───────────────────────────────────

test("client registers a chat-subagent-model definition", () => {
	const definition = chatDefinition();
	assert.equal(definition.target, "chat");
	assert.equal(typeof definition.match, "function");
	assert.equal(typeof definition.start, "function");
	assert.equal(typeof definition.update, "function");
	assert.equal(typeof definition.buildViewNode, "function");
});

test("client locales include the chat model labels (zh/en)", () => {
	const { ctx, dictionaries } = makeCtx();
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	assert.equal(dictionaries.zh["row.chatModelInitial"], "当前供应商/模型");
	assert.equal(dictionaries.zh["row.chatModelChange"], "已切换到");
	assert.equal(dictionaries.zh["row.chatModelResume"], "继续使用");
	assert.equal(dictionaries.en["row.chatModelInitial"], "Current provider/model");
	assert.equal(dictionaries.en["row.chatModelChange"], "Switched to");
	assert.equal(dictionaries.en["row.chatModelResume"], "Resumed on");
});

test("chat match only claims request/header frames", () => {
	const definition = chatDefinition();
	const claimed = definition.match({ type: "request/header", seq: 42 });
	deepEqual(claimed, { id: "42", role: "start" });
	assert.equal(definition.match({ type: "request/context", seq: 43 }), null);
	assert.equal(definition.match({ type: "assistant/message", seq: 44 }), null);
});

test("chat match skips request/header frames that merely start a new series", () => {
	const definition = chatDefinition();
	// DSH 0.1.2 appends reason:"series" when a follow-up turn starts a new
	// request series with an unchanged config — no route change to surface.
	assert.equal(
		definition.match({
			type: "request/header",
			seq: 50,
			data: { reason: "series", header: { config: { provider: "mock-local", model: "deepseek-v4-flash" } } }
		}),
		null
	);
	// The informational reasons still claim their frames.
	deepEqual(definition.match({ type: "request/header", seq: 51, data: { reason: "initial" } }), { id: "51", role: "start" });
	deepEqual(definition.match({ type: "request/header", seq: 52, data: { reason: "change" } }), { id: "52", role: "start" });
	deepEqual(definition.match({ type: "request/header", seq: 53, data: { reason: "resume" } }), { id: "53", role: "start" });
	// A frame without a data payload (older DSH builds) keeps claiming.
	deepEqual(definition.match({ type: "request/header", seq: 54 }), { id: "54", role: "start" });
});

test("chat start labels the initial request with the route (zh)", () => {
	const definition = chatDefinition();
	const event = {
		type: "request/header",
		seq: 9,
		time: 3000,
		data: {
			reason: "initial",
			header: { config: { provider: "mock-local", model: "deepseek-v4-flash" } }
		}
	};
	const state = definition.start(undefined, { event });
	assert.equal(state.kind, "context");
	assert.equal(state.seq, 9);
	assert.equal(state.form, "notice");
	assert.equal(state.source.kind, "plugin");
	assert.equal(state.source.summary, state.content[0].text);
	assert.equal(state.provenance.role, "inject");
	assert.match(state.content[0].text, /当前供应商\/模型/);
	assert.match(state.content[0].text, /mock-local/);
	assert.match(state.content[0].text, /deepseek-v4-flash/);
});

test("chat start labels a failover change with the switched-to route", () => {
	const definition = chatDefinition();
	const event = {
		type: "request/header",
		seq: 10,
		time: 4000,
		data: {
			reason: "change",
			header: { config: { provider: "mock-local", model: "deepseek-v4-pro" } }
		}
	};
	const state = definition.start(undefined, { event });
	assert.match(state.content[0].text, /已切换到/);
	assert.match(state.content[0].text, /mock-local/);
	assert.match(state.content[0].text, /deepseek-v4-pro/);
});

test("chat start labels a resumed session with the route", () => {
	const definition = chatDefinition();
	const event = {
		type: "request/header",
		seq: 11,
		time: 5000,
		data: {
			reason: "resume",
			header: { config: { provider: "mock-local", model: "deepseek-v4-flash" } }
		}
	};
	const state = definition.start(undefined, { event });
	assert.match(state.content[0].text, /继续使用/);
	assert.match(state.content[0].text, /deepseek-v4-flash/);
});

test("chat update is a passthrough and buildViewNode emits a chat context node", () => {
	const definition = chatDefinition();
	const state = {
		kind: "context",
		seq: 9,
		time: 3000,
		content: [{ type: "text", text: "当前供应商/模型：mock-local/deepseek-v4-flash" }],
		source: { kind: "plugin", plugin: "dsh-subagent-default-model" },
		provenance: { role: "inject", label: "dsh-subagent-default-model" },
		form: "notice"
	};
	assert.equal(definition.update({ state }), state);

	const node = definition.buildViewNode({
		key: "k",
		kind: "chat-subagent-model",
		id: "9",
		start: { location: { kind: "unresolved" } },
		state
	});
	assert.equal(node.target, "chat");
	assert.equal(node.kind, "context");
	assert.equal(node.anchorSeq, 9);
	assert.equal(node.visibility, "visible");
	assert.equal(node.data.kind, "context");
	assert.equal(node.data.content[0].text, "当前供应商/模型：mock-local/deepseek-v4-flash");
});

test("chat buildViewNode returns null when no state has been started", () => {
	const definition = chatDefinition();
	assert.equal(definition.buildViewNode({ state: undefined }), null);
});

// ── effort capability check (option A) ─────────────────────────────────────
// A configured `reasoningEffort` the target model does not declare makes every
// delegation die before its first request — the subagent assembles no system
// prompt and injects no context, so it presents as "nothing was injected".
// `checkEffortSupport` surfaces that mismatch in the settings panel. The
// critical property is the conservative direction: an ABSENT catalog entry is
// "unknown", never "unsupported", so a lagging directory cannot produce a false
// alarm against a perfectly valid route.

const checkEffortSupport = capturedModule.factory(factoryRequire).checkEffortSupport;

const CATALOG = [
	{
		id: "workbuddy-global",
		models: [
			{ id: "flash-with-efforts", reasoning: { efforts: [{ id: "max" }, { id: "high" }], defaultEffort: "high" } },
			{ id: "flash-no-declaration" }
		]
	}
];

test("effort check exports a callable seam", () => {
	assert.equal(typeof checkEffortSupport, "function");
});

test("effort check accepts a declared effort", () => {
	assert.equal(checkEffortSupport({ provider: "workbuddy-global", model: "flash-with-efforts", reasoningEffort: "max" }, CATALOG), null);
});

test("effort check flags an effort the model omits", () => {
	const result = checkEffortSupport({ provider: "workbuddy-global", model: "flash-with-efforts", reasoningEffort: "xhigh" }, CATALOG);
	assert.ok(result, "expected a diagnostic");
	assert.equal(result.key, "row.effortNotDeclared");
	assert.equal(result.params.effort, "xhigh");
});

test("effort check flags a model that declares no efforts at all", () => {
	const result = checkEffortSupport({ provider: "workbuddy-global", model: "flash-no-declaration", reasoningEffort: "max" }, CATALOG);
	assert.ok(result, "expected a diagnostic");
	assert.equal(result.key, "row.effortNoDeclaration");
	// `params` is built inside the vm sandbox, so its prototype belongs to the
	// sandbox realm — deepStrictEqual would fail on that alone.
	assert.equal(Object.keys(result.params).length, 0);
});

test("effort check stays silent when no effort is configured", () => {
	assert.equal(checkEffortSupport({ provider: "workbuddy-global", model: "flash-no-declaration" }, CATALOG), null);
});

test("effort check never reports an unknown provider or model as unsupported", () => {
	// A provider or model absent from the catalog is UNKNOWN, not unsupported:
	// reporting it would turn a lagging directory into a false alarm.
	assert.equal(checkEffortSupport({ provider: "not-in-catalog", model: "flash-with-efforts", reasoningEffort: "max" }, CATALOG), null);
	assert.equal(checkEffortSupport({ provider: "workbuddy-global", model: "not-in-catalog", reasoningEffort: "max" }, CATALOG), null);
});

test("effort check tolerates incomplete routes and malformed catalogs", () => {
	assert.equal(checkEffortSupport({ provider: "", model: "m", reasoningEffort: "max" }, CATALOG), null);
	assert.equal(checkEffortSupport({ provider: "workbuddy-global", model: "", reasoningEffort: "max" }, CATALOG), null);
	assert.equal(checkEffortSupport(null, CATALOG), null);
	assert.equal(checkEffortSupport({ provider: "workbuddy-global", model: "flash-no-declaration", reasoningEffort: "max" }, undefined), null);
	assert.equal(checkEffortSupport({ provider: "workbuddy-global", model: "flash-no-declaration", reasoningEffort: "max" }, [null, {}]), null);
});

test("effort check treats an empty efforts array as no declaration", () => {
	const groups = [{ id: "p", models: [{ id: "m", reasoning: { efforts: [] } }] }];
	const result = checkEffortSupport({ provider: "p", model: "m", reasoningEffort: "max" }, groups);
	assert.ok(result);
	assert.equal(result.key, "row.effortNoDeclaration");
});

test("effort warning locales exist in both languages", () => {
	const { ctx, dictionaries } = makeCtx();
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	for (const key of ["row.effortNoDeclaration", "row.effortNotDeclared"]) {
		assert.ok(dictionaries.zh[key], `zh missing ${key}`);
		assert.ok(dictionaries.en[key], `en missing ${key}`);
	}
	assert.match(dictionaries.en["row.effortNotDeclared"], /\{effort\}/);
	assert.match(dictionaries.zh["row.effortNotDeclared"], /\{effort\}/);
});

// ── panel render: the warning must reach the DOM tree ──────────────────────
// The pure check above can regress silently if it is never wired into render.
// This drives the REAL registered card component through a hook-capable React
// double and asserts the warning node appears in the produced tree.

function makeReactDouble() {
	const cells = [];
	const cleanups = [];
	let cursor = 0;
	return {
		// A "pass" is one render: hook cursors restart, state cells persist. That
		// mirrors React closely enough to model "effect ran, state updated,
		// component re-rendered".
		beginPass() { cursor = 0; },
		useState(init) {
			const i = cursor++;
			if (!(i in cells)) cells[i] = typeof init === "function" ? init() : init;
			return [cells[i], (next) => { cells[i] = typeof next === "function" ? next(cells[i]) : next; }];
		},
		useRef(init) {
			const i = cursor++;
			if (!(i in cells)) cells[i] = { current: init };
			return cells[i];
		},
		// Cleanup is deliberately NOT run during a pass: the card's catalog
		// effect guards its async resolve with `alive`, which its cleanup
		// clears — running cleanups eagerly would cancel the very load under
		// test. React does not run cleanup on a normal re-render either.
		useEffect(fn) { const cleanup = fn(); if (typeof cleanup === "function") cleanups.push(cleanup); },
		createElement(type, props, ...children) {
			return { type, props: props ?? {}, children: children.flat() };
		},
		unmount() { for (const cleanup of cleanups.splice(0)) cleanup(); }
	};
}

/** Boolean/number leaves are text in the tree; render them for string matching. */
function renderText(part) {
	if (part === null || part === undefined || part === false || part === true) return "";
	if (Array.isArray(part)) return part.map(renderText).join("");
	if (typeof part === "object") return (part.children ?? []).map(renderText).join("");
	return String(part);
}

/**
 * Expand an element tree the way React would: a function `type` is a component,
 * so call it and render its result. Without this, the card's child component
 * would stay an unexpanded element and the warning inside it would be invisible
 * to assertions.
 */
function expand(node) {
	if (Array.isArray(node)) return node.flatMap(expand);
	if (node === null || node === undefined || typeof node !== "object") return [];
	if (typeof node.type === "function") return expand(node.type(node.props));
	const children = (node.children ?? []).flatMap(expand);
	return [{ type: node.type, props: node.props, children, text: renderText(node.children) }];
}

/** Depth-first collect every expanded node matching a predicate. */
function collect(node, predicate, out = []) {
	// `expand` returns an array at the root, so accept both shapes here.
	if (Array.isArray(node)) {
		for (const item of node) collect(item, predicate, out);
		return out;
	}
	if (node === null || node === undefined || typeof node !== "object") return out;
	if (predicate(node)) out.push(node);
	for (const child of node.children ?? []) collect(child, predicate, out);
	return out;
}

/**
 * Render the REAL registered settings card until it settles, then return the
 * final tree. Two passes are required because the catalog arrives from an
 * async `loadCatalog()` effect: the first pass renders with an empty catalog,
 * the flush resolves it, and the second pass renders the settled panel.
 */
async function renderSettingsCard({ groups, value }) {
	const react = makeReactDouble();
	const reactRequire = (id) => {
		if (id === "react") return react;
		if (id === "@deepseek-ai/dsh-client-ui-primitives") {
			return { Toast: function Toast() {}, IconChevronDownOutline14: function Icon() {} };
		}
		throw new Error(`unexpected require: ${id}`);
	};
	const snapshot = { status: "ready", writable: true, value };
	const { ctx, slotRegistrations, dictionaries } = makeCtx({
		ctx: {
			settingsScope: {
				bind: () => ({ get: async () => value, set: async () => {} }),
				describe: () => ({ load: async () => {} })
			}
		}
	});
	capturedModule.factory(reactRequire).apply(ctx);
	const card = slotRegistrations[0].value.component;
	// Same interpolation contract the locale runtime provides.
	const t = (key, params) => {
		const template = dictionaries.zh?.[key] ?? key;
		return params === undefined ? template : template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
	};
	const props = {
		t,
		settingsScope: { getSnapshot: () => snapshot, subscribe: () => () => {} },
		loadCatalog: async () => groups
	};
	// The card body is hidden while collapsed; seed the open state by rendering
	// the component whose first hook is `useState(false)` as already open.
	const renderPass = () => { react.beginPass(); return expand(card({ ...props })); };
	let tree = renderPass();
	for (let i = 0; i < 4; i++) {
		await Promise.resolve();
		tree = renderPass();
	}
	return { tree, react };
}

/** Flatten a rendered tree to searchable text. */
function treeText(tree) {
	return collect(tree, () => true).map((n) => n.text ?? "").join(" ");
}

test("panel render surfaces the effort mismatch as a warning node", async () => {
	const groups = [{ id: "workbuddy-global", models: [{ id: "flash-no-declaration" }] }];
	const value = { provider: "workbuddy-global", model: "flash-no-declaration", reasoningEffort: "max" };
	const { tree } = await renderSettingsCard({ groups, value });
	const nodes = collect(tree, (n) => n.props && n.props["data-effort-warning"]);
	assert.ok(nodes.length > 0, "expected a warning node in the rendered panel");
	assert.equal(nodes[0].props["data-effort-warning"], "row.effortNoDeclaration");
	// The consolidated list sits next to the save footer, so the warning is
	// visible even without scanning each route row.
	assert.ok(collect(tree, (n) => n.props && n.props["data-effort-warning-count"]).length > 0, "expected the consolidated warning list too");
	assert.match(treeText(tree), /未声明任何推理强度/);
});

test("panel render names the missing effort for an omitted-but-valid effort", async () => {
	const groups = [{ id: "p", models: [{ id: "m", reasoning: { efforts: [{ id: "low" }, { id: "high" }] } }] }];
	const value = { provider: "p", model: "m", reasoningEffort: "xhigh" };
	const { tree } = await renderSettingsCard({ groups, value });
	const nodes = collect(tree, (n) => n.props && n.props["data-effort-warning"]);
	assert.equal(nodes.length, 1);
	assert.equal(nodes[0].props["data-effort-warning"], "row.effortNotDeclared");
	// The interpolation must be resolved, not left as a literal "{effort}".
	assert.match(nodes[0].text, /xhigh/);
	assert.doesNotMatch(nodes[0].text, /\{effort\}/);
});

test("panel render stays clean when the model declares the configured effort", async () => {
	const groups = [{ id: "p", models: [{ id: "m", reasoning: { efforts: [{ id: "max" }] } }] }];
	const value = { provider: "p", model: "m", reasoningEffort: "max" };
	const { tree } = await renderSettingsCard({ groups, value });
	assert.equal(collect(tree, (n) => n.props && n.props["data-effort-warning"]).length, 0);
	assert.equal(collect(tree, (n) => n.props && n.props["data-effort-warning-count"]).length, 0);
});

test("panel render stays clean for an unknown model (lagging catalog is not a warning)", async () => {
	const groups = [{ id: "p", models: [{ id: "advertised" }] }];
	const value = { provider: "p", model: "not-advertised-yet", reasoningEffort: "max" };
	const { tree } = await renderSettingsCard({ groups, value });
	assert.equal(collect(tree, (n) => n.props && n.props["data-effort-warning"]).length, 0);
});
