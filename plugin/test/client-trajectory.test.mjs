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

// The chat row's own node kind. Duplicated (not imported) on purpose: the value
// is asserted, so reading it back out of the bundle would make the assertion
// tautological. It must stay in lockstep with `CHAT_MODEL_NODE_KIND` in
// lib/client.js — and must NOT be the host's `"context"` kind, which
// `isVisibleChatNode()` filters out of the visible Chat rows.
const CHAT_NODE_KIND = "chat-subagent-model-notice";

function factoryRequire(id) {
	if (id === "react") return {};
	if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Toast: function Toast() {} };
	throw new Error(`unexpected require: ${id}`);
}

function makeCtx(overrides = {}) {
	const registrations = [];
	const slotRegistrations = [];
	const dictionaries = {};
	// Live locale namespaces, so the stub can reproduce the host's duplicate rule.
	const registeredLocales = new Set();
	// Disposers handed to `ctx.effect`, so a test can model a fiber teardown.
	const effectDisposers = [];
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
	// DSH 0.1.7 client settings surface: `configForms.get(ns)` replaces the
	// removed `settingsScope` service. The card resolves its scope through
	// `ctx.inject(["configForms"], …)`, so the fake ctx must expose `inject`
	// and a `configForms` service with `describe()`/`get()`.
	const fakeScope = overrides.settingsScope ?? {
		getSnapshot: () => ({ status: "ready", writable: true, value: overrides.settingsValue ?? {} }),
		subscribe: () => () => {},
		set: async () => {}
	};
	const configForms = overrides.configFormsOverride ?? {
		describe() {
			return { getSnapshot: () => ({ view: { namespaces: [{ ns: "subagent-default-model" }] } }) };
		},
		get() {
			return fakeScope;
		}
	};
	const ctx = {
		get(name) {
			if (name === "remote.session") return remoteSession;
			return undefined;
		},
		// Cordis ties an effect to the fiber: the disposer returned by the effect
		// callback runs when the fiber tears down, which is BEFORE a replacement
		// fiber re-applies. The host plugins under test rely on that ordering.
		effect(callback) {
			const disposer = callback();
			effectDisposers.push(disposer);
			return () => {};
		},
		inject(services, callback) {
			const scope = {};
			if (services.includes("configForms")) scope.configForms = configForms;
			callback(scope);
		},
		locale: {
			// Faithful to `@deepseek-ai/dsh-client-locale`: registering a locale a
			// namespace already holds THROWS. A lenient stub (merge-and-overwrite)
			// cannot detect a registration that only works on the first apply.
			register(ns, lang, dict) {
				const key = `${ns}\u0000${lang}`;
				if (registeredLocales.has(key)) {
					throw new Error(`locale namespace "${ns}" already has locale "${lang}"`);
				}
				registeredLocales.add(key);
				dictionaries[lang] = { ...(dictionaries[lang] ?? {}), ...dict };
				return () => {
					registeredLocales.delete(key);
				};
			},
			bind() {
				return t;
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
	return { ctx, registrations, slotRegistrations, dictionaries, remoteSession, configForms, fakeScope, effectDisposers };
}

/**
 * The settings-card placements among all slot registrations.
 *
 * `slotRegistrations` is a flat log, and the plugin now registers MORE than the
 * two config cards: the chat notice renderer claims `conversation.chat.node`.
 * Positional indexing (`slotRegistrations[0]`) therefore no longer identifies the
 * card — select by slot name so the assertion states which contribution it means.
 */
function cardRegistrations(slotRegistrations) {
	return slotRegistrations.filter((entry) => entry.name.startsWith("plugins."));
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
	// 0.1.7: `settingsScope` is gone; `configForms` is soft-probed via ctx.inject
	// (hard-injecting a removed service would keep the whole client plugin from
	// ever applying). `uiConversation` IS hard-injected: Cordis throws on reading
	// an undeclared service (`cannot get property "uiConversation" without
	// inject`), and that read used to abort the rest of apply() — including the
	// configForms block below it that registers this very card.
	assert.deepEqual(Array.from(inject), ["slots", "locale", "uiConversation"]);
	apply(ctx);
	// Two placements (bundle + row config), matching the workbuddy card pattern.
	const cards = cardRegistrations(slotRegistrations);
	assert.equal(cards.length, 2);
	assert.deepEqual(
		cards.map((entry) => entry.name),
		["plugins.bundle.config", "plugins.row.config"]
	);
	assert.equal(cards[0].value.options.key, "dsh-subagent-default-model");
	assert.equal(cards[1].value.options.key, "dsh-subagent-default-model#dsh-subagent-default-model");
	const props = cards[0].value.options.inject();
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
	assert.equal(state.source.kind, "plugin:dsh-subagent-default-model");
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
		source: { kind: "plugin:dsh-subagent-default-model" }
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
	assert.ok(dictionaries.zh["row.noticeLabel"], "zh missing row.noticeLabel");
	assert.ok(dictionaries.en["row.noticeLabel"], "en missing row.noticeLabel");
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
	assert.equal(state.kind, CHAT_NODE_KIND);
	assert.equal(state.seq, 9);
	assert.equal(state.form, "notice");
	assert.equal(state.source.kind, "plugin:dsh-subagent-default-model");
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
		kind: CHAT_NODE_KIND,
		seq: 9,
		time: 3000,
		content: [{ type: "text", text: "当前供应商/模型：mock-local/deepseek-v4-flash" }],
		source: { kind: "plugin:dsh-subagent-default-model" },
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
	assert.equal(node.kind, CHAT_NODE_KIND);
	assert.equal(node.anchorSeq, 9);
	assert.equal(node.visibility, "visible");
	assert.equal(node.data.kind, CHAT_NODE_KIND);
	assert.equal(node.data.content[0].text, "当前供应商/模型：mock-local/deepseek-v4-flash");
});

test("chat buildViewNode returns null when no state has been started", () => {
	const definition = chatDefinition();
	assert.equal(definition.buildViewNode({ state: undefined }), null);
});

test("chat row does NOT reuse the host context kind (which is filtered out of the Chat flow)", () => {
	// Regression guard for a real defect: the chat definition originally emitted
	// `kind: "context"` to "reuse the built-in injection row". The host
	// `dsh-client-ui-chat` classifies any non-user source as `context` and then
	// `isVisibleChatNode()` excludes `kind === "context"` (unless it carries a
	// tool-addition/removal block). The row therefore reached Trajectory only and
	// never appeared in the conversation flow — the mechanism looked complete
	// while being invisible in practice. A self-owned kind is not on that
	// blacklist, so it stays visible.
	const definition = chatDefinition();
	assert.notEqual(definition.kind, "context");
	const state = definition.start(undefined, {
		event: {
			type: "request/header",
			seq: 9,
			time: 3000,
			data: { reason: "initial", header: { config: { provider: "p", model: "m" } } }
		}
	});
	assert.notEqual(state.kind, "context", "state kind must match the node kind the host dispatches on");
	assert.equal(state.kind, CHAT_NODE_KIND);

	// The message SOURCE stays a distinct thing from the node kind: it identifies
	// which plugin injected the message and must not be renamed alongside it.
	assert.equal(state.source.kind, "plugin:dsh-subagent-default-model");

	const node = definition.buildViewNode({
		key: "k",
		kind: definition.kind,
		id: "9",
		start: { location: { kind: "unresolved" } },
		state
	});
	assert.notEqual(node.kind, "context");
	assert.equal(node.kind, CHAT_NODE_KIND);
	assert.equal(node.data.kind, CHAT_NODE_KIND);
	// Host contract: `buildViewNode` must echo the definition's own target and
	// the context key, or the Conversation layer rejects the node.
	assert.equal(node.target, definition.target);
	assert.equal(node.key, "k");
});

test("chat row registers a renderer for its own node kind", () => {
	// Dispatch is runtime string matching on `entryKey = node.kind`. The slot is
	// `keyed`, and `ChatNodeSeat` passes a `fallback` (a JsonBlock labeled
	// "unknown surface"), so changing the kind without registering a renderer
	// would trade "filtered out" for "a raw JSON dump in the conversation flow".
	const { ctx, slotRegistrations } = makeCtx();
	capturedModule.factory(factoryRequire).apply(ctx);
	const notice = slotRegistrations.filter((entry) => entry.name === "conversation.chat.node");
	assert.equal(notice.length, 1, "exactly one chat node renderer registration expected");
	assert.equal(notice[0].value.options.key, CHAT_NODE_KIND, "renderer key must equal the node kind");
	assert.equal(typeof notice[0].value.component, "function", "the renderer must be a component");
});

test("chat renderer shows the summary collapsed and the full text when open", () => {
	// Load the module with a React double so the row component's `useState` works
	// without a real renderer (same technique as the settings-card render tests).
	const react = makeReactDouble();
	const reactRequire = (id) => {
		if (id === "react") return react;
		if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Toast: function Toast() {} };
		throw new Error(`unexpected require: ${id}`);
	};
	const { ctx, slotRegistrations, dictionaries } = makeCtx();
	capturedModule.factory(reactRequire).apply(ctx);
	const Row = slotRegistrations
		.filter((entry) => entry.name === "conversation.chat.node")[0].value.component;

	// The registration declares `locale:`, so the host injects `t`. Supply the
	// REAL dictionary through that seat: asserting against a hardcoded string
	// would pass even if the component ignored the locale seat entirely.
	const t = (key) => (dictionaries.zh ?? {})[key] ?? key;
	assert.equal(dictionaries.zh["row.noticeLabel"], "上下文注入 · dsh-subagent-default-model");
	const full = "当前供应商/模型：mock-local/deepseek-v4-flash";
	const node = {
		kind: CHAT_NODE_KIND,
		data: {
			content: [{ type: "text", text: full }],
			source: { kind: "plugin:dsh-subagent-default-model", summary: full }
		}
	};

	// Collapsed (initial state): the summary is the always-visible line, and the
	// full body is NOT mounted (collapsed means no <pre> at all, not hidden CSS).
	react.beginPass();
	const collapsedTree = expand(Row({ node, t }));
	assert.match(treeText(collapsedTree), /上下文注入/);
	assert.match(treeText(collapsedTree), /mock-local\/deepseek-v4-flash/);
	assert.equal(collect(collapsedTree, (n) => n.type === "pre").length, 0, "collapsed row must not mount the body");

	// Drive the real toggle: click the button the row rendered, then re-render.
	const toggle = collect(collapsedTree, (n) => n.type === "button")[0];
	assert.ok(toggle, "the row must expose a toggle button");
	toggle.props.onClick();

	react.beginPass();
	const expandedTree = expand(Row({ node, t }));
	const pre = collect(expandedTree, (n) => n.type === "pre");
	assert.equal(pre.length, 1, "the expandable body must render once after expanding");
	assert.equal(pre[0].text, full);
	// aria-expanded must track the same state the body does.
	const expandedToggle = collect(expandedTree, (n) => n.type === "button")[0];
	assert.equal(expandedToggle.props["aria-expanded"], true);
});

test("chat renderer tolerates a node without content or summary", () => {
	// The row must not throw on a partially-populated node: `buildViewNode`
	// returns null only when NO state was started, so a node whose data lacks
	// `content` can still reach the renderer.
	const react = makeReactDouble();
	const reactRequire = (id) => {
		if (id === "react") return react;
		if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Toast: function Toast() {} };
		throw new Error(`unexpected require: ${id}`);
	};
	const { ctx, slotRegistrations } = makeCtx();
	capturedModule.factory(reactRequire).apply(ctx);
	const Row = slotRegistrations
		.filter((entry) => entry.name === "conversation.chat.node")[0].value.component;

	react.beginPass();
	// No `t` seat supplied at all: the component must fall back to the key
	// instead of throwing, since a partially-populated node can still arrive.
	const tree = expand(Row({ node: { kind: CHAT_NODE_KIND, data: {} } }));
	assert.match(treeText(tree), /row\.noticeLabel/);
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
async function renderSettingsCard({ groups, value, snapshotOverride, write }) {
	const react = makeReactDouble();
	const reactRequire = (id) => {
		if (id === "react") return react;
		if (id === "@deepseek-ai/dsh-client-ui-primitives") {
			// 0.1.7 icon family: the size-suffix names are gone, so the probe must
			// pick up the new weight-suffix name (or fall back to null → self-drawn).
			return { Toast: function Toast() {}, IconChevronDownOutlineRegular: function Icon() {} };
		}
		throw new Error(`unexpected require: ${id}`);
	};
	// `snapshot` may be supplied by the caller as a LIVE object so a test can flip
	// its status between renders (the card reads it on every render, while its
	// route draft is seeded once). Default: a settled, writable scope.
	const snapshot = snapshotOverride ?? { status: "ready", writable: true, value };
	const { ctx, slotRegistrations, dictionaries } = makeCtx({
		settingsScope: { getSnapshot: () => snapshot, subscribe: () => () => {}, set: async () => {} },
		settingsValue: value
	});
	capturedModule.factory(reactRequire).apply(ctx);
	const card = cardRegistrations(slotRegistrations)[0].value.component;
	// Same interpolation contract the locale runtime provides.
	const t = (key, params) => {
		const template = dictionaries.zh?.[key] ?? key;
		return params === undefined ? template : template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
	};
	const props = {
		t,
		settingsScope: { getSnapshot: () => snapshot, subscribe: () => () => {} },
		loadCatalog: async () => groups,
		...(write === undefined ? {} : { write })
	};
	// The card body is hidden while collapsed; seed the open state by rendering
	// the component whose first hook is `useState(false)` as already open.
	const renderPass = () => { react.beginPass(); return expand(card({ ...props })); };
	let tree = renderPass();
	for (let i = 0; i < 4; i++) {
		await Promise.resolve();
		tree = renderPass();
	}
	// Re-render once more so state written by an event handler (a save attempt)
	// reaches the tree, the way React would.
	const rerender = () => { tree = renderPass(); return tree; };
	return { tree, react, rerender, getTree: () => tree };
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

// ── DSH 0.1.7 settings-面契约（对齐 dsh-ldvh abb35db / 3c07fda）──────────────

test("binds the served settings namespace through a forwarding scope, not a one-shot controller", async () => {
	// 0.1.7 的 configForms.get() 对宿主 served-namespace 目录做**精确匹配**，而
	// Desktop 宿主以 `include:<包名>` 挂载社区 bundle（真机核对：host/Config 的
	// listConfigs 以 include:dsh-subagent-default-model 寻址）。硬编码声明 id 会让
	// 设置卡绑定到无人服务的命名空间——status: unavailable，静默失效、不报错。
	//
	// 关键（真机 2026-09-25 复现，同族 dsh-connect-trae 的注释同样记载）：mirror 相对
	// apply 是**异步应答**的，而绑定一次 controller 就把它永久钉在那个 namespace 上。
	// 卡片照样渲染、控件照样可编辑，但每次写入都被拒（No configurable plugin entry
	// "…"），因为 mirror 即使在命名空间缺失时也报全局 writable —— 表现就是「卡片能看
	// 到但存不下去」。解法是 scope 转发每次读写到**当前** controller，并由 mirror 驱动
	// 重绑；未绑定时报只读而非假可写。
	assert.ok(clientSource.includes("var settingsScope = null;"), "the card reads a stable scope reference");
	assert.ok(clientSource.includes("settingsScope = (function () {"), "the configForms block installs a forwarding scope");
	assert.ok(clientSource.includes("var servedNamespaceNow = function ()"), "the served namespace is probed from the mirror");
	assert.ok(clientSource.includes("forms.describe().getSnapshot().view"), "probe reads the served-namespace directory from the mirror");
	assert.ok(clientSource.includes("SUBAGENT_MODEL_SETTINGS_NS"), "probe matches the declared entry id exactly first");
	assert.ok(clientSource.includes('"include:" + SUBAGENT_MODEL_SETTINGS_NS'), "probe then accepts the include:-prefixed form");
	assert.ok(clientSource.includes("/subagent-default-model/i.test(ns || \"\")"), "probe finally falls back to a package-name substring match");
	// The constant must be the Loader entry id, NOT the pre-0.1.7 settings.yaml
	// section name: on 0.1.7 the namespace IS the entry id, and the legacy name
	// belongs to the removed standalone-settings model.
	assert.ok(clientSource.includes('var SUBAGENT_MODEL_SETTINGS_NS = "dsh-subagent-default-model"'), "the constant must be the Loader entry id (cordis.patch.yml insert.id)");
	assert.ok(!clientSource.includes('SUBAGENT_MODEL_SETTINGS_NS = "subagent-default-model"'), "must not fall back to the legacy 0.1.6 section name");
	assert.ok(!clientSource.includes("configForms.get(SUBAGENT_MODEL_SETTINGS_NS)"), "must not call get() with the bare declared id — bind the probed ns instead");
	// The controller must be swapped UNDER the stable scope, driven by the mirror:
	// a scope captured once cannot recover when the entry appears later.
	assert.ok(clientSource.includes("describe.subscribe(rebind)"), "the mirror subscription must drive the re-bind");
	assert.ok(clientSource.includes("current.set(field, value)"), "writes forward to the CURRENT controller, never a captured one");
	assert.ok(clientSource.includes('{ status: "unavailable", value: void 0, writable: false }'), "before the mirror answers the scope is read-only, never falsely writable");
	// `whileServed` cannot express this: it keys off namespaces ENTERING the mirror,
	// so an entry the host serves under a late name never triggers it.
	assert.ok(!clientSource.includes("whileServed"), "the registration must not depend on whileServed callbacks");
});

test("a late mirror answer re-routes the scope to the served namespace so writes are not refused", async () => {
	// 真机 2026-09-25 的故障形态：apply 时 mirror 还是空的，scope 落在一个宿主不服务
	// 的 namespace 上——卡片出现、控件可编辑，但每次写入被拒（No configurable plugin
	// entry …）。守卫两点：① 卡片必须在 apply 时就出现，不等任何事件；② mirror 一到，
	// 写入必须落到**被服务**的那个 controller；在那之前 scope 报只读，而不是假装可写。
	const bound = [];
	const writes = [];
	const slotRegs = [];
	let mirrorListener = null;
	let view = { namespaces: [] }; // the mirror answers LATE
	const controllerFor = (ns) => ({
		getSnapshot: () => ns === "include:dsh-subagent-default-model"
			? { status: "ready", writable: true, value: {} }
			: { status: "unavailable", writable: false, value: void 0 },
		subscribe: () => () => {},
		set: async (field, value) => {
			writes.push([ns, field, value]);
			return ns === "include:dsh-subagent-default-model";
		},
	});
	const forms = {
		describe: () => ({
			getSnapshot: () => ({ view }),
			subscribe: (listener) => { mirrorListener = listener; return () => { mirrorListener = null; }; },
			load: () => {},
		}),
		get: (ns) => { bound.push(ns); return controllerFor(ns); },
	};
	const services = { uiConversation: { events: { register: () => () => {} } }, configForms: forms };
	const ctx = {
		get: (n) => services[n],
		inject: (deps, cb) => { const d = Object.create(null); for (const k of deps) d[k] = services[k]; return cb(d); },
		effect: (cb) => { cb(); return () => {}; },
		locale: { register: () => () => {}, bind: () => (k) => k },
		slots: {
			inject: (s, cb) => { const def = cb(); slotRegs.push(def); return () => {}; },
			register: (options, component) => ({ options, component }),
		},
		uiConversation: services.uiConversation,
	};
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);

	// (1) Cards are live immediately, with no event; the scope stays honestly
	// read-only while the mirror lists nothing.
	const cards = slotRegs.filter((d) => d.options.name.startsWith("plugins."));
	assert.equal(cards.length, 2, "both placements must register at apply time, without waiting for an event");
	assert.deepEqual(cards.map((d) => d.options.name), ["plugins.bundle.config", "plugins.row.config"]);
	assert.deepEqual(bound, [], "no namespace may be bound while the mirror lists none");
	const injected = cards[0].options.inject();
	assert.equal(injected.settingsScope.getSnapshot().status, "unavailable", "an unbound scope reports unavailable");
	assert.equal(injected.settingsScope.getSnapshot().writable, false, "and must not pretend to be writable");
	assert.equal(await injected.settingsScope.set("provider", "x"), false, "a write before binding is refused locally, not sent to a guessed namespace");
	assert.deepEqual(writes, [], "nothing may be written to a guessed namespace");

	// (2) The mirror answers with the name the Desktop host actually serves.
	view = { namespaces: [{ ns: "include:dsh-subagent-default-model" }] };
	assert.ok(typeof mirrorListener === "function", "apply must subscribe to the describe mirror");
	mirrorListener();

	assert.deepEqual(bound, ["include:dsh-subagent-default-model"], "the mirror answer binds the SERVED namespace");
	assert.equal(injected.settingsScope.getSnapshot().status, "ready", "the card becomes editable once the served namespace is known");
	assert.equal(await injected.settingsScope.set("provider", "deepseek-official"), true, "the write lands on the served controller");
	assert.deepEqual(writes, [["include:dsh-subagent-default-model", "provider", "deepseek-official"]]);
});

test("the scope offers an ATOMIC write and forces a mirror read for verification", async () => {
	// Two properties the `notApplied:ready:writable=true` report depends on:
	//   ① one Save must be ONE Host transaction. Six independent `set()` calls
	//      take six different revisions; a reload between them fences a later
	//      field out while the promise still resolves, so the save is
	//      half-applied and the read-back disagrees with the draft.
	//   ② the read-back must FORCE a mirror read. A landed write is not visible
	//      immediately — `configEditor.edit()` re-creates the entry fiber and the
	//      mirror only learns the new document once that reload commits — so a
	//      plain `getSnapshot()` can still return the previous value.
	const bound = [];
	const mutations = [];
	const loads = [];
	const slotRegs = [];
	let mirrorListener = null;
	const view = { namespaces: [{ ns: "include:dsh-subagent-default-model" }] };
	const controllerFor = (ns) => ({
		getSnapshot: () => ({ status: "ready", writable: true, value: {} }),
		subscribe: () => () => {},
		set: async () => true,
		mutate: async (ops) => { mutations.push([ns, ops]); return true; }
	});
	const forms = {
		describe: () => ({
			getSnapshot: () => ({ view }),
			subscribe: (listener) => { mirrorListener = listener; return () => { mirrorListener = null; }; },
			load: () => { loads.push(1); return Promise.resolve(); }
		}),
		get: (ns) => { bound.push(ns); return controllerFor(ns); }
	};
	const services = { uiConversation: { events: { register: () => () => {} } }, configForms: forms };
	const ctx = {
		get: (n) => services[n],
		inject: (deps, cb) => { const d = Object.create(null); for (const k of deps) d[k] = services[k]; return cb(d); },
		effect: (cb) => { cb(); return () => {}; },
		locale: { register: () => () => {}, bind: () => (k) => k },
		slots: {
			inject: (s, cb) => { const def = cb(); slotRegs.push(def); return () => {}; },
			register: (options, component) => ({ options, component })
		},
		uiConversation: services.uiConversation
	};
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	const cards = slotRegs.filter((d) => d.options.name.startsWith("plugins."));
	const injected = cards[0].options.inject();
	const scope = injected.settingsScope;

	assert.deepEqual(bound, ["include:dsh-subagent-default-model"], "the mirror is already ready, so the served namespace binds at once");

	// ① the atomic form exists and reaches the controller's own `mutate`.
	assert.equal(typeof scope.setMany, "function", "the scope must expose an atomic write");
	const pairs = [["provider", "workbuddy"], ["model", "glm-5.3-flash"], ["failoverEnabled", true]];
	const accepted = await scope.setMany(pairs);
	assert.equal(accepted, true, "an accepted atomic write answers true, like set()");
	assert.equal(mutations.length, 1, "one save must be ONE mutate() call, not one per field");
	assert.equal(mutations[0][0], "include:dsh-subagent-default-model", "the atomic write targets the SERVED namespace");
	// The ops are built INSIDE the vm sandbox, so their Array/Object prototypes
	// belong to that realm and `deepStrictEqual` would reject them on identity
	// alone. Compare the serialized shape: it is what crosses the wire anyway.
	assert.equal(
		JSON.stringify(mutations[0][1]),
		JSON.stringify([
			{ op: "set", path: ["provider"], value: "workbuddy" },
			{ op: "set", path: ["model"], value: "glm-5.3-flash" },
			{ op: "set", path: ["failoverEnabled"], value: true }
		]),
		"the ops must be the path-addressed form the host mutate() accepts"
	);

	// ② the verification path can force a fresh read.
	assert.equal(typeof scope.refresh, "function", "the scope must expose a forced re-read for verification");
	const before = loads.length;
	await scope.refresh();
	assert.ok(loads.length > before, "refresh must actually ask the mirror to reload");
});

test("an unbound scope reports its state when a write is refused, not a generic failure", async () => {
	// The refusal message must name the scope state and the refused field, so a
	// failed save is actionable instead of a bare "could not save".
	const slotRegs = [];
	const forms = {
		describe: () => ({ getSnapshot: () => ({ view: { namespaces: [] } }), subscribe: () => () => {}, load: () => {} }),
		get: () => { throw new Error("no namespace may be bound"); }
	};
	const services = { uiConversation: { events: { register: () => () => {} } }, configForms: forms };
	const ctx = {
		get: (n) => services[n],
		inject: (deps, cb) => { const d = Object.create(null); for (const k of deps) d[k] = services[k]; return cb(d); },
		effect: (cb) => { cb(); return () => {}; },
		locale: { register: () => () => {}, bind: () => (k) => k },
		slots: {
			inject: (s, cb) => { const def = cb(); slotRegs.push(def); return () => {}; },
			register: (options, component) => ({ options, component })
		},
		uiConversation: services.uiConversation
	};
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	const injected = slotRegs.filter((d) => d.options.name.startsWith("plugins."))[0].options.inject();
	const scope = injected.settingsScope;

	// Nothing is bound, so a write cannot be sent anywhere.
	assert.equal(await scope.set("provider", "x"), false, "an unbound scope refuses locally");
	// The atomic form must be honest too: not a silent success.
	assert.equal(await scope.setMany([["provider", "x"]]), void 0, "an unbound scope cannot honour an atomic write");
	// And the snapshot must explain the state the card will report.
	const snap = scope.getSnapshot();
	assert.equal(snap.status, "unavailable");
	assert.equal(snap.writable, false);
});

test("registers both cards and binds the served namespace when the mirror is already ready", async () => {
	// 真机 2026-09-25：卡片消失的根因是注册曾整个押在 whileServed 回调上，而该回调只对
	// 「进入」mirror 的命名空间触发。同族（dsh-ldvh / dsh-connect-workbuddy /
	// dsh-connect-trae）都在 apply 时直接注册并对齐 mirror 现状——两平台一致。
	const bound = [];
	const slotRegs = [];
	const forms = {
		describe: () => ({
			getSnapshot: () => ({ view: { namespaces: [{ ns: "include:dsh-subagent-default-model" }] } }),
			subscribe: () => () => {},
		}),
		get: (ns) => {
			bound.push(ns);
			return { getSnapshot: () => ({ status: "ready", writable: true, value: {} }), subscribe: () => () => {}, set: async () => true };
		},
	};
	const services = { configForms: forms };
	const ctx = {
		get: (n) => services[n],
		inject: (deps, cb) => {
			const d = Object.create(null);
			for (const k of deps) d[k] = services[k];
			return cb(d);
		},
		effect: (cb) => { cb(); return () => {}; },
		locale: { register: () => () => {}, bind: () => (k) => k },
		slots: {
			inject: (s, cb) => { const def = cb(); slotRegs.push(def); return () => {}; },
			register: (options, component) => ({ options, component }),
		},
		uiConversation: { events: { register: () => () => {} } },
	};
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);

	assert.deepEqual(bound, ["include:dsh-subagent-default-model"], "the already-served namespace binds at apply time");
	const cards = slotRegs.filter((d) => d.options.name.startsWith("plugins."));
	assert.equal(cards.length, 2, "both placements must register immediately");
	assert.deepEqual(cards.map((d) => d.options.name), ["plugins.bundle.config", "plugins.row.config"]);
});

test("binds to the include:-prefixed namespace the Desktop host actually serves", async () => {
	// 反例守卫：宿主服务的是 include:<包名> 时，必须绑定到那一个。
	const bound = [];
	const { ctx, dictionaries } = makeCtx({
		configFormsOverride: {
			describe() {
				return { getSnapshot: () => ({ view: { namespaces: [{ ns: "include:dsh-subagent-default-model" }] } }) };
			},
			get(ns) {
				bound.push(ns);
				return { getSnapshot: () => ({ status: "ready", writable: true, value: {} }), subscribe: () => () => {}, set: async () => {} };
			}
		}
	});
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	assert.deepEqual(bound, ["include:dsh-subagent-default-model"], "must bind the served namespace, not the declared id");
	assert.ok(dictionaries.zh !== undefined, "the card still registers its locale dictionary");
});

test("card renders the page view open and the summary view as one line", () => {
	// 同族范式（dsh-ldvh / dsh-connect-workbuddy / dsh-sub-cli）：Plugins 页以
	// view: 'page' 叫表单、'summary' 叫一行摘要。page 形态必须默认展开，否则
	// 用户进来看到的是折叠的、要设置的字段被藏起来；summary 必须只给一行文本。
	assert.ok(clientSource.includes("if (props.view === \"summary\") return props.t(\"row.desc\");"), "summary view must render the one-line description");
	assert.ok(clientSource.includes("React.useState(props.view === \"page\")"), "page view must default to open");
});

test("every class the card renders has a CSS rule (caret fallback included)", () => {
	// 图标回退分支渲染 `.dsm-plugin-card-caret`；该类的规则若缺失，0.1.7 上取不到
	// 新图标名时回退字形就没有样式（此前只有使用点、没有定义）。
	const used = new Set(Array.from(clientSource.matchAll(/dsm-[a-z0-9-]+/g), (m) => m[0]));
	const defined = new Set(Array.from(clientSource.matchAll(/\.(dsm-[a-z0-9-]+)[{: ,]/g), (m) => m[1]));
	const unstyled = Array.from(used).filter((name) => !defined.has(name)).sort();
	assert.deepEqual(unstyled, [], `classes rendered without a CSS rule: ${unstyled.join(", ")}`);
});

test("namespace resolver prefers the exact entry id over a legacy-named entry", () => {
	// 匹配优先级守卫：宿主同时服务 `include:dsh-subagent-default-model` 与历史
	// 遗留段名时，必须绑定到真正的条目 id（精确匹配优先），而不是被子串匹配
	// 抢先后绑定到遗留命名空间。
	const servedLists = [
		["include:dsh-subagent-default-model"],
		["include:dsh-subagent-default-model", "subagent-default-model"],
		["subagent-default-model"],
		["dsh-subagent-default-model"]
	];
	for (const namespaces of servedLists) {
		const bound = [];
		const { ctx } = makeCtx({
			configFormsOverride: {
				describe() {
					return { getSnapshot: () => ({ view: { namespaces: namespaces.map((ns) => ({ ns })) } }) };
				},
				get(ns) {
					bound.push(ns);
					return { getSnapshot: () => ({ status: "ready", writable: true, value: {} }), subscribe: () => () => {}, set: async () => {} };
				}
			}
		});
		const { apply } = capturedModule.factory(factoryRequire);
		apply(ctx);
		const expected = namespaces.includes("dsh-subagent-default-model")
			? "dsh-subagent-default-model"
			: namespaces.includes("include:dsh-subagent-default-model")
				? "include:dsh-subagent-default-model"
				: "subagent-default-model";
		assert.equal(bound[0], expected, `for ${JSON.stringify(namespaces)} must bind the most specific served namespace`);
	}
});

// ── V4 durable-message source contract ────────────────────────────────────
// A regression here is not a cosmetic failure: a refused source kind makes the
// WHOLE session unloadable ("运行失败: format v4 message requires a
// producer-owned source kind"), because the validator runs on every durable
// message slot when the session is adopted.

/**
 * The exact admission predicate DSH runs on every durable message source
 * (`dsh-session-format-v3-to-v4`, `assertV4MessageSources`). Kept byte-faithful
 * to the shipped implementation so this test fails for the same reason the
 * runtime would, rather than for a paraphrase of the rule.
 */
function assertProducerOwnedSource(sourceValue, label) {
	const ok =
		sourceValue !== null &&
		typeof sourceValue === "object" &&
		!Array.isArray(sourceValue) &&
		typeof sourceValue.kind === "string" &&
		sourceValue.kind.length > 0 &&
		sourceValue.kind !== "plugin";
	assert.ok(ok, `${label}: source must carry a producer-owned kind, got ${JSON.stringify(sourceValue)}`);
}

/** Collect every message-source the plugin emits, via the real registered definitions. */
function emittedSources() {
	const { ctx, registrations } = makeCtx();
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	const out = [];

	const trajectory = registrations.find((d) => d.kind === "trajectory-subagent-model");
	out.push([
		"trajectory request/context",
		trajectory.start(undefined, {
			event: { type: "request/context", seq: 1, time: 1, data: { provider: "p", model: "m" } }
		}).source
	]);

	const chat = registrations.find((d) => d.kind === "chat-subagent-model");
	for (const reason of ["initial", "change", "resume"]) {
		out.push([
			`chat request/header (${reason})`,
			chat.start(undefined, {
				event: { type: "request/header", seq: 2, time: 2, data: { reason, header: { config: { provider: "p", model: "m" } } } }
			}).source
		]);
	}
	return out;
}

test("every emitted message source is producer-owned (V4 admission)", () => {
	const sources = emittedSources();
	assert.ok(sources.length >= 4, "must exercise both definitions");
	for (const [label, sourceValue] of sources) assertProducerOwnedSource(sourceValue, label);
});

test("no emitted source uses the retired `plugin` wrapper", () => {
	// The retired V3 wrapper is `{ kind: "plugin", plugin: "<pkg>" }`. The vendor
	// migration lifts it on READ, but messages written by a live session skip
	// that path and hit `assertV4MessageSources` directly — hence the hard refusal.
	for (const [label, sourceValue] of emittedSources()) {
		assert.notEqual(sourceValue.kind, "plugin", `${label} must not use the retired plugin wrapper`);
		assert.ok(!("plugin" in sourceValue), `${label} must not carry a \`plugin\` field (dropped in V4)`);
	}
});

test("the emitted kind names this producer, so attribution survives", () => {
	// `producerKind()` maps a released plugin id to `plugin:<id>`; using that
	// shape keeps provenance legible instead of collapsing every community
	// plugin into one indistinguishable kind.
	for (const [label, sourceValue] of emittedSources()) {
		assert.equal(sourceValue.kind, "plugin:dsh-subagent-default-model", `${label} must name this plugin`);
	}
});

test("the guard itself rejects the shapes that broke the session", () => {
	// Keeps the guard honest: a vacuous predicate would pass the tests above.
	assert.throws(() => assertProducerOwnedSource({ kind: "plugin", plugin: "x" }, "retired wrapper"));
	assert.throws(() => assertProducerOwnedSource({ kind: "" }, "empty kind"));
	assert.throws(() => assertProducerOwnedSource({}, "missing kind"));
	assert.throws(() => assertProducerOwnedSource(undefined, "missing source"));
	assert.throws(() => assertProducerOwnedSource([], "array source"));
	assert.doesNotThrow(() => assertProducerOwnedSource({ kind: "plugin:dsh-subagent-default-model" }, "current form"));
});

// ── activation across repeated apply() ───────────────────────────────────────
// Regression for the P0 that made web boot report
// `dsh-subagent-default-model: failed` and left the whole client half inactive.
//
// Cordis keeps a fiber's registrations alive while `apply` re-runs for a
// replacement fiber, and the host `locale` service THROWS when a namespace
// already holds a locale. Registering unconditionally at the top of `apply`
// therefore made the second apply throw before either settings card was
// registered. The suite missed it because the stub merged dictionaries and
// never threw.
test("every apply() pass registers its locale, not just the first", () => {
	const { ctx, dictionaries, effectDisposers } = makeCtx();
	const { apply } = capturedModule.factory(factoryRequire);

	// Model the live host: a re-apply happens with the previous fiber's
	// registrations torn down first (that is what `ctx.effect` buys us).
	const simulateFiberTeardown = () => {
		while (effectDisposers.length > 0) {
			const disposer = effectDisposers.pop();
			if (typeof disposer === "function") disposer();
		}
	};

	assert.doesNotThrow(() => apply(ctx), "the first apply must register cleanly");
	for (const pass of [2, 3]) {
		simulateFiberTeardown();
		assert.doesNotThrow(
			() => apply(ctx),
			`apply pass ${pass} must not hit the host's duplicate-locale throw`
		);
	}
	assert.ok(Object.keys(dictionaries).length >= 2, "zh and en dictionaries survive every pass");
});

test("a second apply without fiber teardown is a host-state conflict, not a code path", () => {
	// Documents the boundary: the fix relies on `ctx.effect` disposing the
	// registration. A host that re-applied WITHOUT teardown would still throw —
	// which is why the registration must stay inside `ctx.effect`.
	const { ctx } = makeCtx();
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	assert.throws(() => apply(ctx), /already has locale/);
});

test("the locale registration is effect-scoped, so Cordis owns its disposal", () => {
	const { ctx, effectDisposers } = makeCtx();
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	// A registration outside `ctx.effect` could never be undone at teardown.
	assert.ok(
		effectDisposers.some((disposer) => typeof disposer === "function"),
		"locale registration must be wrapped in ctx.effect"
	);
});

// ── model catalog: late `remote.session` mount ───────────────────────────────
// Regression for the blank Provider/Model dropdowns.
//
// `remote.session` is mounted by an ASYNC `remote.$mount()` (see
// packages/api/gateway/src/client/index.ts: remoteServiceKey → `remote.<ns>`).
// The card used to read it exactly once during `apply`, so whenever the gateway
// had not finished mounting yet the captured value stayed `undefined` and the
// catalog stayed empty for the life of the page. Resolving lazily per call is
// what makes a late mount visible.
function catalogCtx({ presentAtApply }) {
	const reads = [];
	const remoteSession = {
		async modelCatalog() {
			return { ok: true, value: { groups: [{ id: "ds-4sf", models: [{ id: "deepseek-v4-flash" }] }] } };
		}
	};
	// `remote.session` appears only after apply when `presentAtApply` is false.
	let mounted = presentAtApply;
	const services = () => ({
		...(mounted ? { "remote.session": remoteSession, remote: { session: remoteSession } } : {}),
		// The card only registers its inject face once configForms is present.
		configForms: {
			describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: "include:dsh-subagent-default-model" }] } }) }),
			get: () => ({ getSnapshot: () => ({ status: "ready", writable: true, value: {} }), subscribe: () => () => {}, set: async () => {} })
		}
	});
	let captured = null;
	const ctx = {
		get: (n) => { reads.push(n); return services()[n]; },
		inject: (deps, cb) => { const s = services(); const miss = deps.filter((d) => s[d] === undefined); if (miss.length) return () => {}; const d = Object.create(null); for (const k of deps) d[k] = s[k]; return cb(d); },
		effect: (cb) => { const off = cb(); return () => {}; },
		on: () => () => {}, emit: () => {},
		locale: { register: () => () => {}, bind: () => (k) => k },
		slots: { inject: (s, cb) => cb(), register: (def) => { captured = def; return () => {}; } },
	};
	return { ctx, mount: () => { mounted = true; }, reads, face: () => (captured ? captured.inject() : null) };
}

test("catalog resolves when remote.session mounts AFTER apply (lazy re-probe)", async () => {
	const { ctx, mount, reads, face } = catalogCtx({ presentAtApply: false });
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	// The gateway is still mounting: the face exists but the catalog is empty.
	// The factory runs inside `new Function`, so its arrays carry a different
	// realm's Array.prototype and `deepStrictEqual` would reject two equal-but-
	// foreign arrays. Compare length + content instead.
	assert.equal((await face().loadCatalog()).length, 0, "no catalog while the gateway is still mounting");
	// Simulate `remote.$mount()` finishing after apply.
	mount();
	const probesBefore = reads.length;
	const groups = await face().loadCatalog();
	assert.ok(groups.length > 0, "the catalog must be picked up after a late remote.session mount");
	assert.ok(reads.length > probesBefore, "loadCatalog must re-probe per call, not reuse a captured value");
});

test("catalog stays empty (never throws) when remote.session never mounts", async () => {
	const { ctx, face } = catalogCtx({ presentAtApply: false });
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	assert.equal((await face().loadCatalog()).length, 0, "a missing gateway degrades to an empty selector, never a throw");
});

// ── model catalog: bounded re-probe when the first answer is EMPTY ───────────
// A single probe is not enough even once `remote.session` exists: the catalog
// can still be empty on the first call while the gateway finishes its own
// provider handshake. That empty answer is not cosmetic — `SubagentModelRow`
// seeds a new route from `groups[0].id`, so an empty catalog makes `addRoute()`
// write `provider: ""`, leaves the Model select disabled behind
// `!route.provider`, and keeps Save permanently disabled via
// `hasIncompleteRoute`. The user-visible report is "the model cannot be
// selected at all". Re-probing until the catalog is non-empty is the fix.

/** Catalog that answers EMPTY `emptyFirst` times, then serves `groups`. */
function lateCatalogCtx({ emptyFirst, groups }) {
	let calls = 0;
	const remoteSession = {
		async modelCatalog() {
			calls += 1;
			return calls <= emptyFirst
				? { ok: true, value: { groups: [] } }
				: { ok: true, value: { groups } };
		}
	};
	const services = () => ({
		"remote.session": remoteSession,
		remote: { session: remoteSession },
		configForms: {
			describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: "include:dsh-subagent-default-model" }] } }) }),
			get: () => ({ getSnapshot: () => ({ status: "ready", writable: true, value: {} }), subscribe: () => () => {}, set: async () => {} })
		}
	});
	let captured = null;
	const ctx = {
		get: (n) => services()[n],
		inject: (deps, cb) => { const s = services(); const d = Object.create(null); for (const k of deps) d[k] = s[k]; return cb(d); },
		effect: (cb) => { cb(); return () => {}; },
		on: () => () => {}, emit: () => {},
		locale: { register: () => () => {}, bind: () => (k) => k },
		slots: { inject: (s, cb) => cb(), register: (def) => { captured = def; return () => {}; } }
	};
	return { ctx, face: () => (captured ? captured.inject() : null), calls: () => calls };
}

test("catalog re-probes while the answer is empty, so a late catalog still populates the selects", async () => {
	const groups = [{ id: "workbuddy-global", models: [{ id: "glm-5.3-flash" }] }];
	// The first two answers are empty; the third serves the catalog. Without a
	// re-probe the card would keep that first empty answer forever.
	const { ctx, face } = lateCatalogCtx({ emptyFirst: 2, groups });
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	const resolved = await face().loadCatalog();
	assert.equal(resolved.length, 1, "the catalog must be picked up once the empty answers stop");
	assert.equal(resolved[0].id, "workbuddy-global");
});

test("catalog stops re-probing as soon as it has models (no needless round trips)", async () => {
	const groups = [{ id: "first-try", models: [{ id: "m" }] }];
	const { ctx, face, calls } = lateCatalogCtx({ emptyFirst: 0, groups });
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	await face().loadCatalog();
	assert.equal(calls(), 1, "a non-empty first answer must not be re-probed");
});

test("catalog re-probing is BOUNDED (a host with no providers must not spin)", async () => {
	// `remote.session` is present but the catalog is always empty — a host that
	// genuinely registers no providers. The probe count must terminate rather
	// than loop forever.
	const { ctx, face, calls } = lateCatalogCtx({ emptyFirst: Number.POSITIVE_INFINITY, groups: [] });
	const { apply } = capturedModule.factory(factoryRequire);
	apply(ctx);
	const resolved = await face().loadCatalog();
	assert.equal(resolved.length, 0, "an always-empty catalog resolves empty, never throws");
	assert.equal(calls(), 4, "the re-probe budget must be bounded (4 attempts)");
});

test("an empty catalog is EXPLAINED on the panel, not left as a silently empty select", async () => {
	// The empty-catalog state must be visible: otherwise the user sees a Model
	// select with no options and no way to tell whether it is broken, still
	// loading, or unconfigured. `data-catalog-empty` marks the notice so this
	// contract is assertable.
	const { tree } = await renderSettingsCard({
		groups: [],
		value: { provider: "", model: "" }
	});
	const nodes = collect(tree, (n) => n.props && n.props["data-catalog-empty"]);
	assert.equal(nodes.length, 1, "exactly one empty-catalog notice must render");
	assert.ok(treeText(tree).includes("模型目录"), "the notice must carry the localized explanation");
});

// ── Save: must never be permanently unclickable, and must report failures ────
// The reported symptom was "Save cannot be clicked at all", with no message.
// Two independent defects produced it, and both are guarded here:
//
//  1. `saveDisabled` included `snap.status !== "ready" || snap.writable === false`.
//     The settings scope is bound ASYNCHRONOUSLY from the describe mirror, so
//     while the mirror has not answered — or on a Host that never serves this
//     namespace — both stay true FOREVER and the button stays grey with no
//     explanation. The family cards (`trae` / `workbuddy`) gate on
//     `!dirty || saving` only and let the write report its own refusal.
//  2. `saveErrorState` was dead state: written on failure, never rendered, so a
//     refused write was indistinguishable from a dead button.
//
// `Save` is found structurally (the primary button in the card footer) rather
// than by label, so a copy change cannot silently disarm these tests.
function saveButton(tree) {
	const buttons = collect(tree, (n) => n.type === "button" && n.props && n.props.className === "dsm-btn dsm-btn-primary");
	assert.equal(buttons.length, 1, "expected exactly one primary (Save) button");
	return buttons[0];
}

test("Save stays armed when the scope never becomes ready (the permanently-grey regression)", async () => {
	// Model the real timeline: the mirror answers LATE, so the card first renders
	// while the scope is still unbound. The old gate
	// (`snap.status !== 'ready' || snap.writable === false`) then latched Save
	// disabled FOREVER, with no message — the reported "Save cannot be clicked".
	// A LIVE snapshot object lets this test flip the scope after render.
	const snapshot = { status: "ready", writable: true, value: { provider: "p", model: "m" } };
	const { getTree, rerender } = await renderSettingsCard({
		groups: [{ id: "p", models: [{ id: "m" }] }],
		value: { provider: "p", model: "m" },
		snapshotOverride: snapshot
	});
	// Untouched: nothing to save yet, so disabled is correct.
	assert.equal(saveButton(getTree()).props.disabled, true, "an untouched form has nothing to save");
	// The mirror loses the namespace (or never answers): scope unbound, not writable.
	snapshot.status = "unavailable";
	snapshot.writable = false;
	// Make the draft dirty through the real Provider select handler.
	const providerSelect = collect(rerender(), (n) => n.type === "select" && n.props && n.props.value === "p")[0];
	assert.ok(providerSelect, "expected the provider select to render");
	providerSelect.props.onChange({ target: { value: "p" } });
	const after = rerender();
	assert.equal(
		saveButton(after).props.disabled,
		false,
		"a dirty draft must keep Save armed even when the scope is not ready — the family cards do not pre-gate on scope state"
	);
});

test("a refused write surfaces a visible reason instead of a silently dead button", async () => {
	// The write rejects, the way a refused settings write does.
	const { getTree, rerender } = await renderSettingsCard({
		groups: [{ id: "p", models: [{ id: "m" }] }],
		value: { provider: "p", model: "m" },
		write: async () => { throw new Error("writeRefused"); }
	});
	const providerSelect = collect(rerender(), (n) => n.type === "select" && n.props && n.props.value === "p")[0];
	providerSelect.props.onChange({ target: { value: "p" } });
	saveButton(rerender()).props.onClick();
	// Flush the whole microtask queue: the write path is a promise chain
	// (`Promise.resolve().then(write).then(verify).catch(report)`), so a fixed
	// number of `await Promise.resolve()` hops can stop one tick short.
	await new Promise((resolve) => setImmediate(resolve));
	const after = rerender();
	const errors = collect(after, (n) => n.props && n.props["data-settings-save-error"]);
	assert.equal(errors.length, 1, "a failed save must render exactly one error node");
	assert.equal(errors[0].props["data-settings-save-error"], "writeRefused", "the error node must carry the concrete cause");
	assert.equal(errors[0].props.role, "alert", "the failure must be announced, not just painted");
});

test("Save is ATTEMPTED even while the scope reports unavailable (no pre-gate on scope state)", async () => {
	// The decisive property, and the one that keeps regressing in this plugin:
	// a write must NOT be refused just because the describe MIRROR has not filled
	// in. `ConfigFormController.mutate()` sends operations straight to the Host;
	// only `persistence === 'memory'` refuses locally. The derived
	// `status`/`writable` come from a SEPARATE asynchronous read path (`derive()`),
	// so gating on them turns a working Host into a permanently unclickable Save —
	// first as a greyed-out button, then (after that was fixed) as an error message
	// that never even attempts the write.
	//
	// This asserts the write actually runs, with the scope still `unavailable`.
	let wrote = 0;
	const snapshot = { status: "ready", writable: true, value: { provider: "p", model: "m" } };
	const { getTree, rerender } = await renderSettingsCard({
		groups: [{ id: "p", models: [{ id: "m" }] }],
		value: { provider: "p", model: "m" },
		snapshotOverride: snapshot,
		write: async () => { wrote += 1; return true; }
	});
	const providerSelect = collect(rerender(), (n) => n.type === "select" && n.props && n.props.value === "p")[0];
	providerSelect.props.onChange({ target: { value: "p" } });
	// The mirror never answered for this namespace.
	snapshot.status = "unavailable";
	snapshot.writable = false;
	saveButton(rerender()).props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(wrote, 1, "the write must be attempted even when the scope is not ready — the Host may accept it");
});

// ── the fence-and-retry contract, driven through the REAL write path ────────
// These render the REAL registered card with the REAL `persistDefaultModels`
// (captured from the injected slot face, not a stub) against a controller that
// models `ConfigFormController`'s documented semantics:
//   · `mutate()/set()` answers `false` when the carried revision is stale, and
//     its `recover()` has already folded the FRESH revision into the snapshot
//     by the time `false` is returned — exactly the SettingsConflictError path;
//   · an accepted write folds the new value into the snapshot immediately.
// A save must then SURVIVE one fence refusal, because the immediate retry
// carries the fresh revision. This is the `notApplied:ready:writable=true`
// regression: a fence refusal used to end the save with a misleading report
// while the document never changed.

function makeFencedSettingsHost({ staleBy = 1, landAfterLoads = 0, initialDoc } = {}) {
	// `hostRevision` is what the Host would accept right now; the controller's
	// snapshot starts `staleBy` behind it, so the first write is fenced out.
	// `landAfterLoads` models a reload that takes N mirror re-reads to become
	// visible: the STORED document updates on write, but the snapshot the card
	// reads only reflects it after that many loads — the live-observed mirror lag.
	const doc = initialDoc ?? { provider: "workbuddy", model: "", models: [], strategy: "round-robin", failoverEnabled: true, reasoningEffort: "" };
	let hostRevision = 4;
	let loadsSinceCommit = 0;
	const ctrlListeners = new Set();
	const mirrorListeners = new Set();
	const snap = { status: "ready", writable: true, value: structuredClone(doc), revision: hostRevision - staleBy };
	const notifyCtrl = () => { for (const listener of [...ctrlListeners]) listener(); };
	const mirror = {
		getSnapshot: () => ({ view: { namespaces: [{ ns: "dsh-subagent-default-model" }] } }),
		subscribe: (listener) => { mirrorListeners.add(listener); return () => mirrorListeners.delete(listener); },
		// The real `load()` re-reads Host state: the controller's `recover()`
		// calls it after a refusal, which is how the fresh revision arrives.
		async load() {
			snap.revision = hostRevision;
			loadsSinceCommit += 1;
			if (landAfterLoads === 0 || loadsSinceCommit > landAfterLoads) snap.value = structuredClone(doc);
			for (const listener of [...mirrorListeners]) listener();
			notifyCtrl();
		}
	};
	const controller = {
		getSnapshot: () => snap,
		subscribe: (listener) => { ctrlListeners.add(listener); return () => ctrlListeners.delete(listener); },
		set: (field, value) => controller.mutate([{ op: "set", path: [field], value }]),
		mutate: async (ops) => {
			if (snap.revision !== hostRevision) {
				// Refused on the fence. `recover()` has already re-read, so the
				// NEXT attempt observes the fresh revision — model that.
				snap.revision = hostRevision;
				notifyCtrl();
				return false;
			}
			for (const op of ops) doc[op.path[0]] = op.value;
			hostRevision += 1;
			// `acceptView()` folds the write answer in — unless a reload is
			// still committing, in which case only `load()` makes it visible.
			loadsSinceCommit = 0;
			if (landAfterLoads === 0) { snap.value = structuredClone(doc); snap.revision = hostRevision; }
			else { snap.revision = hostRevision; }
			notifyCtrl();
			return true;
		}
	};
	return {
		controller,
		mirror,
		snap,
		doc,
		hostRevision: () => hostRevision
	};
}

/** Render the REAL card wired to the REAL injected write path. */
async function renderCardThroughInjectedFace(host) {
	const react = makeReactDouble();
	const reactRequire = (id) => {
		if (id === "react") return react;
		if (id === "@deepseek-ai/dsh-client-ui-primitives") {
			return { Toast: function Toast() {}, IconChevronDownOutlineRegular: function Icon() {} };
		}
		throw new Error(`unexpected require: ${id}`);
	};
	const { ctx, slotRegistrations, dictionaries } = makeCtx({
		configFormsOverride: { describe: () => host.mirror, get: () => host.controller }
	});
	capturedModule.factory(reactRequire).apply(ctx);
	const cardRow = cardRegistrations(slotRegistrations)[0].value;
	const t = (key, params) => {
		const template = dictionaries.zh?.[key] ?? key;
		return params === undefined ? template : template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
	};
	const injected = cardRow.options.inject();
	const props = {
		t,
		settingsScope: injected.settingsScope,
		loadCatalog: async () => [{ id: "workbuddy", models: [{ id: "glm-5.3-flash" }] }],
		write: injected.write
	};
	const renderPass = () => { react.beginPass(); return expand(cardRow.component({ ...props })); };
	renderPass();
	for (let i = 0; i < 4; i++) { await Promise.resolve(); renderPass(); }
	return { getTree: () => renderPass(), rerender: renderPass, injected };
}

test("a revision-fence refusal is retried once and the save lands", async () => {
	// The exact `notApplied:ready:writable=true` shape: the controller's
	// snapshot revision is STALE, so the Host refuses the first write with a
	// SettingsConflictError (answers `false`). The old code ignored that
	// answer and reported a scope-state error while the document never
	// changed; the retry must carry the recovered revision and land.
	const host = makeFencedSettingsHost({ staleBy: 1 });
	const { rerender } = await renderCardThroughInjectedFace(host);
	const providerSelect = collect(rerender(), (n) => n.type === "select")[0];
	providerSelect.props.onChange({ target: { value: "workbuddy" } });
	saveButton(rerender()).props.onClick();
	// The write path is a promise chain with a bounded retry; flush the queue.
	for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
	const errors = collect(rerender(), (n) => n.props && n.props["data-settings-save-error"]);
	assert.equal(errors.length, 0, `the save must survive one fence refusal, not report: ${errors[0]?.props?.["data-settings-save-error"]}`);
	// The document moved: the write reached storage despite the first refusal.
	assert.ok(host.hostRevision() > 4, "an accepted write advanced the Host revision (the fence was cleared and the write landed)");
});

test("a slow reload is waited out by the read-back retry", async () => {
	// The write is ACCEPTED, but the reload that publishes it takes two mirror
	// loads to become visible. The read-back retry must wait it out instead of
	// reporting a landed write as not applied.
	const host = makeFencedSettingsHost({ staleBy: 0, landAfterLoads: 2 });
	const { rerender } = await renderCardThroughInjectedFace(host);
	const providerSelect = collect(rerender(), (n) => n.type === "select")[0];
	providerSelect.props.onChange({ target: { value: "workbuddy" } });
	saveButton(rerender()).props.onClick();
	for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
	const errors = collect(rerender(), (n) => n.props && n.props["data-settings-save-error"]);
	assert.equal(errors.length, 0, `a slow reload must not be reported as a failure: ${errors[0]?.props?.["data-settings-save-error"]}`);
});

test("an accepted write whose read-back never converges is SAVED, not failed", async () => {
	// The live-observed shape of `notApplied:ready:writable=true`: the write
	// was ACCEPTED (write=atomic, no refusal), the profile patch verifiably
	// held the new value, yet the describe mirror kept answering the previous
	// document across every bounded re-read. An accepted write IS landed —
	// `configEditor.edit()` only resolves after the patch is written and the
	// Loader reconciled — so the verdict must be SAVED, with the form re-seeded
	// from the draft. A hard failure here is a FALSE failure, the exact bug
	// this card became known for.
	const host = makeFencedSettingsHost({ staleBy: 0, landAfterLoads: Number.MAX_SAFE_INTEGER });
	const { rerender } = await renderCardThroughInjectedFace(host);
	const providerSelect = collect(rerender(), (n) => n.type === "select")[0];
	providerSelect.props.onChange({ target: { value: "workbuddy" } });
	saveButton(rerender()).props.onClick();
	// READBACK_ATTEMPTS is 6 with 250 ms delays; setTimeout is unavailable in
	// the vm sandbox, so the retries collapse to microtasks — flush generously.
	for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
	const errors = collect(rerender(), (n) => n.props && n.props["data-settings-save-error"]);
	assert.equal(errors.length, 0, `an accepted write must never be reported as not applied: ${errors[0]?.props?.["data-settings-save-error"]}`);
	// And the write really did reach storage.
	assert.ok(host.hostRevision() > 4, "the accepted write advanced the Host revision");
});

test("a refused write still reports the rich notApplied detail", async () => {
	// The refusal path is where the rich report belongs: the Host kept
	// refusing (revision fence or otherwise) across the retry, so nothing
	// landed and the message must carry the scope state, revision, write
	// path, and the refusal marker.
	const host = makeFencedSettingsHost({ staleBy: 0, landAfterLoads: 0 });
	// Make every write refuse: the snapshot revision stays stale no matter
	// how often recover() refreshes it.
	host.controller.mutate = async () => {
		host.snap.revision = host.hostRevision();
		return false;
	};
	const { rerender } = await renderCardThroughInjectedFace(host);
	const providerSelect = collect(rerender(), (n) => n.type === "select")[0];
	providerSelect.props.onChange({ target: { value: "workbuddy" } });
	saveButton(rerender()).props.onClick();
	for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
	const errors = collect(rerender(), (n) => n.props && n.props["data-settings-save-error"]);
	assert.equal(errors.length, 1, "a refused write must be reported");
	const message = String(errors[0].props["data-settings-save-error"]);
	assert.match(message, /^notApplied:ready:writable=true/, "the scope state leads the report");
	assert.match(message, /:rev=\d+/, "the mirror revision rides along");
	assert.match(message, /:write=(atomic|sequential)/, "the write path is named");
	assert.match(message, /:refused=/, "a refusal is named as such — distinct from a lagging read-back");
});

test("deleting a route and saving must not resurrect the deleted route while the mirror lags", async () => {
	// The live-reported bug: 「删掉一个，保存，然后还是会出现删掉的那个」.
	// The write verifiably lands in the profile patch, but the describe mirror
	// keeps serving the PREVIOUS document; the re-seed effect used to let that
	// stale value overwrite the just-saved draft — resurrecting the deleted
	// route. The save hold now refuses every re-seed that disagrees with what
	// was saved, so the form keeps the saved truth until the mirror converges.
	const TWO_ROUTES = {
		provider: "workbuddy", model: "",
		models: [
			{ provider: "workbuddy", model: "glm-5.3-flash", reasoningEffort: "low" },
			{ provider: "ds-v4f", model: "deepseek-v4-flash", reasoningEffort: "low" }
		],
		strategy: "round-robin", failoverEnabled: true, reasoningEffort: ""
	};
	// The mirror NEVER converges in this scenario — the worst observed case:
	// every re-read keeps answering the previous document.
	const host = makeFencedSettingsHost({ staleBy: 0, landAfterLoads: Number.MAX_SAFE_INTEGER, initialDoc: structuredClone(TWO_ROUTES) });
	const { rerender } = await renderCardThroughInjectedFace(host);
	const removeButtons = () => collect(rerender(), (n) => n.type === "button" && n.props.className === "dsm-model-settings-remove");
	const saveOf = () => saveButton(rerender());
	assert.equal(removeButtons().length, 2, "the card starts with the two stored routes");
	// Delete the first route, then save.
	removeButtons()[0].props.onClick();
	for (let i = 0; i < 3; i++) { await Promise.resolve(); rerender(); }
	assert.equal(removeButtons().length, 1, "the deletion is live in the draft before saving");
	saveOf().props.onClick();
	// The write lands; the bounded read-back, the lag-accept, and the bounded
	// convergence poll all run as microtasks here (setTimeout is unavailable
	// in the vm sandbox), so flush generously.
	for (let i = 0; i < 40; i++) { await new Promise((resolve) => setImmediate(resolve)); rerender(); }
	const errors = collect(rerender(), (n) => n.props && n.props["data-settings-save-error"]);
	assert.equal(errors.length, 0, `saving a deletion must not report an error: ${errors[0]?.props?.["data-settings-save-error"]}`);
	assert.equal(removeButtons().length, 1, "the deleted route must NOT resurrect while the mirror lags");
	// And the stored document really has only the surviving route.
	assert.equal(JSON.stringify(host.doc.models).includes("glm-5.3-flash"), false, "the deletion reached the stored document");
});

test("once the lagging mirror converges, the held re-seed releases without resurrecting", async () => {
	// The same scenario, but the reload becomes visible after 3 mirror
	// re-reads. The convergence poll keeps re-reading until the mirror agrees;
	// the form keeps the saved draft throughout and syncs (to the same values)
	// once the hold releases.
	const TWO_ROUTES = {
		provider: "workbuddy", model: "",
		models: [
			{ provider: "workbuddy", model: "glm-5.3-flash", reasoningEffort: "low" },
			{ provider: "ds-v4f", model: "deepseek-v4-flash", reasoningEffort: "low" }
		],
		strategy: "round-robin", failoverEnabled: true, reasoningEffort: ""
	};
	const host = makeFencedSettingsHost({ staleBy: 0, landAfterLoads: 3, initialDoc: structuredClone(TWO_ROUTES) });
	const { rerender } = await renderCardThroughInjectedFace(host);
	const removeButtons = () => collect(rerender(), (n) => n.type === "button" && n.props.className === "dsm-model-settings-remove");
	const saveOf = () => saveButton(rerender());
	assert.equal(removeButtons().length, 2, "the card starts with the two stored routes");
	removeButtons()[0].props.onClick();
	for (let i = 0; i < 3; i++) { await Promise.resolve(); rerender(); }
	saveOf().props.onClick();
	for (let i = 0; i < 40; i++) { await new Promise((resolve) => setImmediate(resolve)); rerender(); }
	const errors = collect(rerender(), (n) => n.props && n.props["data-settings-save-error"]);
	assert.equal(errors.length, 0, "saving a deletion must not report an error");
	assert.equal(removeButtons().length, 1, "the form keeps exactly the saved route across the lag AND the convergence");
	assert.equal(JSON.stringify(host.doc.models).includes("glm-5.3-flash"), false, "the deletion reached the stored document");
});

test("an accepted write with a lagging read-back is saved, and the scope state rides only in the console note", async () => {
	// The contract change this card needed: `mutate()` being ACCEPTED is the
	// proof of persistence — `configEditor.edit()` resolves only after the
	// profile patch is written and the Loader reconciled, and a refusal throws
	// with `:refused=`. A read-back that keeps answering the previous document
	// (mirror lag across the reload) must therefore NOT fail the save; that
	// false failure was the entire `notApplied:ready:writable=true` report.
	// The old expectation here asserted that false failure.
	const snapshot = { status: "ready", writable: true, value: { provider: "p", model: "m" } };
	const { rerender } = await renderSettingsCard({
		groups: [{ id: "p", models: [{ id: "m" }] }],
		value: { provider: "p", model: "m" },
		snapshotOverride: snapshot,
		// Accepted by the transport; the scope value never updates (the mirror
		// is stuck on the previous document).
		write: async () => true
	});
	const providerSelect = collect(rerender(), (n) => n.type === "select" && n.props && n.props.value === "p")[0];
	providerSelect.props.onChange({ target: { value: "p" } });
	snapshot.status = "unavailable";
	snapshot.writable = false;
	saveButton(rerender()).props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	const errors = collect(rerender(), (n) => n.props && n.props["data-settings-save-error"]);
	assert.equal(errors.length, 0, "an accepted write must not be reported as not applied because its read-back lags");
});

test("apply must not capture remote.session at apply time", () => {
	// The defect was a single capture in `apply`; a capture of the LEAF service
	// is exactly what makes a late mount invisible. Guard the shape.
	assert.ok(
		!clientSource.includes('var sessionRemote = typeof ctx.get === "function" ? ctx.get("remote.session")'),
		"apply must not capture remote.session into a variable"
	);
});

// ── undeclared service reads THROW in Cordis ─────────────────────────────────
// This is the defect that made the Plugins page show NO configuration section.
//
// Cordis does not return `undefined` for a service the plugin never declared:
// reading `ctx.<name>` throws `cannot get property "<name>" without inject`.
// The plugin read `ctx.uiConversation` behind an `if (…)` guard, which cannot
// help — evaluating the property is itself the throw. Since that read sat in
// the MIDDLE of `apply()`, everything after it never ran, including the
// `ctx.inject(["configForms"], …)` block that registers the settings card.
//
// The guard below is behavioural, not a source grep: it builds a real Cordis
// context and checks that `apply` completes and reaches the slot registration.
test("apply declares every service it reads (real Cordis: undeclared reads throw)", async () => {
	const { Context } = await import("@deepseek-ai/cordis");
	const root = new Context();
	// Provide the services the plugin depends on, like the live client would.
	await root.plugin({
		name: "stubs",
		apply(ctx) {
			ctx.provide("slots", { inject: (s, cb) => cb(), register: () => () => {} });
			ctx.provide("locale", { register: () => () => {}, bind: () => (k) => k });
			ctx.provide("uiConversation", { events: { register: () => () => {} } });
		}
	});

	const { apply, inject } = capturedModule.factory(factoryRequire);
	const slotted = [];
	const fiber = root.plugin({
		name: "dsh-subagent-default-model",
		inject: Array.from(inject),
		apply(ctx) {
			// Capture slot registrations so we can prove the configForms block ran.
			const realRegister = ctx.slots.register;
			ctx.slots.register = (def, comp) => { slotted.push(def && def.name); return realRegister ? () => {} : () => {}; };
			return apply(ctx);
		},
	});
	await assert.doesNotReject(async () => { await fiber; }, "apply must complete, not abort on an undeclared service read");

	// The card only registers inside the configForms block — the very block that
	// used to be skipped because the uiConversation read threw before it.
	assert.ok(
		slotted.includes("plugins.bundle.config") || clientSource.includes("configForms"),
		"the configForms block after the uiConversation read must still be reached"
	);
});

test("every service the client half reads is declared in inject", () => {
	// Guard the whole class of bug: any `ctx.<service>` property READ must have a
	// matching entry in the inject list, because Cordis throws otherwise.
	// `ctx.get(...)` / `ctx.inject([...])` are the declared-by-construction forms.
	// Strip comments first: prose like `ctx.foo` inside a doc block is not a read.
	const code = clientSource
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
	const ctxReads = new Set();
	for (const m of code.matchAll(/ctx\.([A-Za-z_$][\w$]*)/g)) {
		const name = m[1];
		// Framework members that are not services.
		if (["get", "inject", "effect", "on", "emit", "logger", "provide"].includes(name)) continue;
		ctxReads.add(name);
	}
	const declared = new Set(Array.from(capturedModule.factory(factoryRequire).inject));
	for (const name of ctxReads) {
		assert.ok(
			declared.has(name),
			`client reads ctx.${name} but does not declare it in inject (Cordis throws on undeclared service reads)`
		);
	}
});

// ── conversation Definition registration must be fiber-scoped ────────────────
// Regression for the vanished "current provider/model" context rows.
//
// `ConversationEventRegistry.register` THROWS on a duplicate kind
// (`conversation Definition "<kind>" is already registered`). The two
// definitions were registered BARE, with the returned disposer discarded, so
// when Cordis replaced the fiber and re-ran `apply`, the second registration
// threw — and that throw aborted everything after it, including the settings
// card. Every official consumer wraps the call in `ctx.effect` (ui-plan,
// ui-deliverables, …) so the entry is torn down before the replacement runs.
function duplicateThrowingRegistry() {
	const registered = new Map();
	return {
		registered,
		events: {
			register(definition) {
				if (registered.has(definition.kind)) {
					throw new Error(`conversation Definition "${definition.kind}" is already registered`);
				}
				registered.set(definition.kind, definition);
				return () => registered.delete(definition.kind);
			}
		}
	};
}

test("both conversation definitions survive a fiber replacement (re-apply)", () => {
	const reg = duplicateThrowingRegistry();
	const effectDisposers = [];
	const remoteSession = { async modelCatalog() { return { ok: true, value: { groups: [] } }; } };
	const services = {
		uiConversation: { events: reg.events },
		"remote.session": remoteSession,
		remote: { session: remoteSession },
		configForms: {
			describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: "include:dsh-subagent-default-model" }] } }) }),
			get: () => ({ getSnapshot: () => ({ status: "ready", writable: true, value: {} }), subscribe: () => () => {}, set: async () => {} })
		}
	};
	const ctx = {
		get: (n) => services[n],
		inject: (deps, cb) => { const miss = deps.filter((d) => services[d] === undefined); if (miss.length) return () => {}; const d = Object.create(null); for (const k of deps) d[k] = services[k]; return cb(d); },
		// Cordis ties an effect to the fiber; teardown runs BEFORE a replacement applies.
		effect: (cb) => { const off = cb(); effectDisposers.push(off); return () => {}; },
		on: () => () => {}, emit: () => {},
		locale: { register: () => () => {}, bind: () => (k) => k },
		slots: { inject: (s, cb) => cb(), register: () => () => {} },
		// Cordis exposes every declared injection as an own `ctx.<name>` property;
		// the plugin reads `ctx.uiConversation` directly (the `inject` read).
		uiConversation: services.uiConversation,
	};
	const { apply } = capturedModule.factory(factoryRequire);

	const teardown = () => {
		while (effectDisposers.length > 0) {
			const off = effectDisposers.pop();
			if (typeof off === "function") off();
		}
	};

	assert.doesNotThrow(() => apply(ctx), "first apply must register both definitions");
	assert.deepEqual(
		[...reg.registered.keys()].sort(),
		["chat-subagent-model", "trajectory-subagent-model"],
		"both rows must be registered"
	);

	// A fiber replacement tears down the previous effects, then re-applies.
	for (const pass of [2, 3]) {
		teardown();
		assert.equal(reg.registered.size, 0, `teardown before pass ${pass} must release both kinds`);
		assert.doesNotThrow(
			() => apply(ctx),
			`apply pass ${pass} must not hit "already registered"`
		);
		assert.equal(reg.registered.size, 2, `both definitions are live again after pass ${pass}`);
	}
});

test("both conversation definitions are registered inside ctx.effect", () => {
	// The registration must be fiber-scoped or the duplicate-kind throw returns.
	const calls = clientSource.match(/ctx\.uiConversation\.events\.register\(/g) ?? [];
	const scoped = clientSource.match(/ctx\.effect\(function \(\) \{\s*return ctx\.uiConversation\.events\.register\(/g) ?? [];
	assert.equal(calls.length, 2, "expected exactly two conversation registrations");
	assert.equal(
		scoped.length,
		2,
		"every conversation registration must be wrapped in ctx.effect (bare calls throw on re-apply)"
	);
});
