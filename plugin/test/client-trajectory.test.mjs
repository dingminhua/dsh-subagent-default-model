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
