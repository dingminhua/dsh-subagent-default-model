// End-to-end retry simulation for the failover "Subagent model" trajectory row.
//
// Drives the REAL plugin host code: a subagent request hits a connection-class
// error (RATE_LIMIT) → failover returns {kind:"retry"} and switches to the next
// model in the pool → we simulate the agent-loop behaviour of appending a
// `request/context` frame when provider/model change → we load the REAL client
// bundle (client.js) in a vm sandbox and feed that frame through the registered
// trajectory definition → the rendered node is printed and written into a small
// HTML preview so you can see exactly what appears in the subagent trajectory.
//
// Run: node plugin/scripts/simulate-retry.mjs
// Output: preview-trajectory-model.html (open in a browser)

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Context } from "@deepseek-ai/cordis";
import { SettingsProvider } from "@deepseek-ai/dsh-settings";
import * as defaultModelPlugin from "../lib/index.js";

// ── harness (mirrors plugin/test/failover.test.mjs) ─────────────────────────

class MemorySettings extends SettingsProvider {
	constructor(ctx, document) {
		super(ctx, "settings");
		this.document = document;
	}

	async load() {
		return this.document;
	}

	get writable() {
		return false;
	}
}

async function createHarness(document = {}) {
	const root = new Context();
	root.provide("subagents", {
		async start(name, request) {
			return { name, request };
		},
		async startContinuable(spec) {
			return spec;
		}
	});
	const settings = new MemorySettings(root, document);
	await settings.load().then((loaded) => settings.publish(loaded));
	await root[Symbol.for("cordis.init")]?.();
	const fiber = root.registry.plugin(defaultModelPlugin);
	await fiber;
	return { root, settings, fiber };
}

function makeAgent(id, { origin = "subagent", provider = "deepseek-official", model = "deepseek-v4-pro" } = {}) {
	return {
		id,
		options: { provider, model },
		session: {
			id,
			header: { origin, model },
			requestContext: () => ({ provider, model })
		}
	};
}

function dispatchRequestError(ctx, agent, failure = { message: "rate limit exceeded", code: "RATE_LIMIT" }) {
	return ctx.waterfall(
		"agent/request-error",
		{ agent, turn: 1, step: 1, provider: agent.options.provider, failure, signal: new AbortController().signal },
		() => Promise.resolve(void 0)
	);
}

function dispatchRequest(ctx, agent, seed) {
	return ctx.waterfall(
		"agent/request",
		{ agent, turn: 1, step: 1, signal: new AbortController().signal },
		() => Promise.resolve(seed)
	);
}

// ── load the real client bundle and capture its trajectory definition ───────

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

function loadClientDefinitions() {
	const { apply } = capturedModule.factory(function requireStub(id) {
		if (id === "react") return {};
		if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Toast: function Toast() {} };
		throw new Error(`unexpected require: ${id}`);
	});
	const registrations = [];
	const zh = {
		"row.trajectoryModel": "子代理模型",
		"row.chatModelInitial": "子代理模型",
		"row.chatModelChange": "已切换到",
		"row.chatModelResume": "继续使用"
	};
	apply({
		connection: { api: {} },
		locale: {
			register() {},
			bind() {
				return (key) => zh[key] ?? key;
			}
		},
		settingsScope: {
			bind() {
				return { get: async () => ({}), set: async () => {} };
			}
		},
		slots: { inject() {} },
		conversationEvents: {
			register(definition) {
				registrations.push(definition);
			}
		}
	});
	const trajectory = registrations.find((d) => d.kind === "trajectory-subagent-model");
	assert.ok(trajectory, "trajectory-subagent-model definition not registered");
	const chat = registrations.find((d) => d.kind === "chat-subagent-model");
	assert.ok(chat, "chat-subagent-model definition not registered");
	return { trajectory, chat };
}

// ── simulate agent-loop request/context append (as dsh-agent-loop does) ─────

function appendRequestContextIfChanged(sessionPostedEvents, previous, next) {
	if (previous.provider !== next.provider || previous.model !== next.model) {
		sessionPostedEvents.push({ type: "request/context", seq: 10, time: 1234567890, data: { ...next } });
	}
}

// ── run the simulation ──────────────────────────────────────────────────────

const SECTION = {
	"subagent-default-model": {
		provider: "deepseek-official",
		model: "deepseek-v4-pro",
		models: ["deepseek-v4-pro", "deepseek-v4-flash"],
		strategy: "round-robin",
		failoverEnabled: true
	}
};

const harness = await createHarness(SECTION);
try {
	const agent = makeAgent("sub-1");
	const initial = { provider: "deepseek-official", model: "deepseek-v4-pro" };

	// (1) subagent request fails with a connection-class error
	console.log("① subagent 请求失败 → dispatch agent/request-error (RATE_LIMIT)");
	const action = await dispatchRequestError(harness.root, agent);
	assert.deepEqual(action, { kind: "retry" });
	console.log("   → failover 返回", JSON.stringify(action));

	// (2) the loop rebuilds the request → plugin applies the next model
	const config = await dispatchRequest(harness.root, agent, { ...initial });
	console.log("② 重建请求 → agent/request 应用新模型:", JSON.stringify(config));
	assert.deepEqual(config, { provider: "deepseek-official", model: "deepseek-v4-flash" });

	// (3) agent-loop appends request/context when provider/model changed
	const posted = [];
	appendRequestContextIfChanged(posted, initial, config);
	console.log("③ agent-loop 检测到模型变化 → 追加 request/context 帧:", JSON.stringify(posted[0].data));

	// (4) the client trajectory definition renders it
	const { trajectory, chat } = loadClientDefinitions();
	const claimed = trajectory.match(posted[0]);
	const state = trajectory.start(undefined, { event: posted[0] });
	const node = trajectory.buildViewNode({ key: "k", kind: trajectory.kind, id: claimed.id, start: { location: { kind: "unresolved" } }, state });
	console.log("④ 轨迹定义渲染节点 →", JSON.stringify({ kind: node.data.node.kind, text: node.data.node.content[0].text }));

	const label = node.data.node.content[0].text;
	assert.match(label, /deepseek-official/);
	assert.match(label, /deepseek-v4-flash/);

	// (5) simulate the chat view: request/header frames (initial + failover change)
	const headerInitial = {
		type: "request/header",
		seq: 20,
		time: 1234567890,
		data: { reason: "initial", header: { config: { provider: "deepseek-official", model: "deepseek-v4-pro" } } }
	};
	const headerChange = {
		type: "request/header",
		seq: 21,
		time: 1234567990,
		data: { reason: "change", header: { config: { provider: "deepseek-official", model: "deepseek-v4-flash" } } }
	};
	const chatNodes = [headerInitial, headerChange].map((event) => {
		const m = chat.match(event);
		assert.ok(m, "chat definition should claim request/header");
		const s = chat.start(undefined, { event });
		return chat.buildViewNode({ key: `k-${event.seq}`, kind: chat.kind, id: m.id, start: { location: { kind: "unresolved" } }, state: s });
	});
	console.log("⑤ 对话定义渲染 request/header 帧 →");
	for (const n of chatNodes) {
		console.log("   -", JSON.stringify(n.data.content[0].text));
	}
	assert.match(chatNodes[0].data.content[0].text, /子代理模型/);
	assert.match(chatNodes[0].data.content[0].text, /deepseek-v4-pro/);
	assert.match(chatNodes[1].data.content[0].text, /已切换到/);
	assert.match(chatNodes[1].data.content[0].text, /deepseek-v4-flash/);

	// (6) write a small visual preview (trajectory + chat views)
	const chatTexts = chatNodes.map((n) => n.data.content[0].text);
	const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>预览：subagent 轨迹 & 对话视图模型提示</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 40px; background: #101114; color: #e6e6e6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .panel { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 16px; font-weight: 600; color: #e6e6e6; }
  .caption { font-size: 12px; color: #999; margin: 4px 0 20px; }
  .card { border: 1px solid #36373b; border-radius: 12px; background: #202126; padding: 14px 16px; font-size: 13px; line-height: 1.6; margin-bottom: 20px; }
  .card-title { font-size: 12px; font-weight: 600; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
  .row { padding: 6px 10px; border-radius: 8px; }
  .row.retry { color: #b8b8b8; background: rgba(250, 190, 60, 0.08); margin-bottom: 6px; }
  .row.model { color: #e6e6e6; background: rgba(86, 134, 254, 0.10); }
  .row.user { color: #e6e6e6; background: rgba(255, 255, 255, 0.05); margin-bottom: 6px; }
  .tag { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 10px; margin-right: 8px; vertical-align: 1px; }
  .tag.retry { background: rgba(250, 190, 60, 0.18); color: #fabe3c; }
  .tag.model { background: rgba(86, 134, 254, 0.22); color: #80a3ff; }
  .tag.user { background: rgba(255, 255, 255, 0.14); color: #ccc; }
  .raw { margin-top: 16px; font-size: 11px; color: #888; white-space: pre-wrap; word-break: break-all; }
</style>
</head>
<body>
  <div class="panel">
    <h1>subagent 模型提示 · 效果预览</h1>
    <div class="caption">黄色 = DSH 官方重试行（仅说明上下文）；蓝色 = 本插件新增。</div>

    <div class="card">
      <div class="card-title">轨迹视图（已确认生效）</div>
      <div class="row retry"><span class="tag retry">内置</span>已重试模型请求（1/5）· 4s<br/>失败原因：Connection error.</div>
      <div class="row model"><span class="tag model">插件</span>${label}</div>
      <div class="raw">实际渲染节点：\n${JSON.stringify({ kind: node.data.node.kind, seq: state.seq, source: state.source, content: node.data.node.content }, null, 2)}</div>
    </div>

    <div class="card">
      <div class="card-title">对话视图（新增）</div>
      <div class="row user"><span class="tag user">用户</span>…给子代理的最小任务…</div>
      <div class="row model"><span class="tag model">插件</span>${chatTexts[0]}</div>
      <div class="row retry"><span class="tag retry">内置</span>已重试模型请求（1/5）· 4s<br/>失败原因：Connection error.</div>
      <div class="row model"><span class="tag model">插件</span>${chatTexts[1]}</div>
      <div class="raw">实际渲染节点：\n${JSON.stringify(chatNodes.map((n) => ({ kind: n.data.kind, seq: n.data.seq, source: n.data.source, form: n.data.form, provenance: n.data.provenance, content: n.data.content })), null, 2)}</div>
    </div>
  </div>
</body>
</html>`;
	writeFileSync(new URL("../preview-trajectory-model.html", import.meta.url), html);
	console.log("✅ 模拟完成，预览已写入 preview-trajectory-model.html");
} finally {
	await harness.fiber.dispose();
	await harness.root.fiber.dispose();
}