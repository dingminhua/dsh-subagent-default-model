// Live integration check against the running local mock LLM server.
//
// Unlike simulate-retry.mjs (pure in-memory), this script makes REAL HTTP calls
// to http://127.0.0.1:8799:
//   1. call the fail model  → expect HTTP 429 (RATE_LIMIT)
//   2. feed that failure through the REAL plugin failover waterfall
//   3. plugin returns the next model (round-robin → deepseek-v4-flash)
//   4. call the ok model over HTTP → expect HTTP 200
//
// This mirrors what DSH's LLM adapter does (HTTP status + error body → failure),
// so it verifies the full "real error → real switch → real success" path.
//
// Run: node plugin/scripts/verify-mock-failover.mjs  (start `npm run mock` first)

import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { SettingsProvider } from "@deepseek-ai/dsh-settings";
import * as defaultModelPlugin from "../lib/index.js";

const BASE = "http://127.0.0.1:8799/v1";
const FAIL_MODEL = "deepseek-v4-pro";
const OK_MODEL = "deepseek-v4-flash";

// ── minimal OpenAI-compatible call ──────────────────────────────────────────

async function callChat(model) {
	const res = await fetch(`${BASE}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }] })
	});
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

/** Translate an HTTP error into the {message, code} failure DSH's adapter would emit. */
function failureFromHttp({ status, body }) {
	if (status < 400) return null;
	const err = body?.error ?? {};
	const code = (err.code ?? err.type ?? "SERVER").toString().toUpperCase();
	return { message: err.message ?? `HTTP ${status}`, code, status };
}

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

async function createHarness(document) {
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
	return { root, fiber };
}

function makeAgent(id, { provider = "mock-local", model = FAIL_MODEL } = {}) {
	return {
		id,
		options: { provider, model },
		session: {
			id,
			header: { origin: "subagent", model },
			requestContext: () => ({ provider, model })
		}
	};
}

function dispatchRequestError(ctx, agent, failure) {
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

// ── run ─────────────────────────────────────────────────────────────────────

const SECTION = {
	"subagent-default-model": {
		provider: "mock-local",
		model: FAIL_MODEL,
		models: [FAIL_MODEL, OK_MODEL],
		strategy: "round-robin",
		failoverEnabled: true
	}
};

console.log("① 真实调用 fail 模型:", FAIL_MODEL);
const failCall = await callChat(FAIL_MODEL);
console.log(`   → HTTP ${failCall.status}`, failCall.body?.error?.message ?? "");
assert.equal(failCall.status, 429, "expected the fail model to return 429");

const failure = failureFromHttp(failCall);
assert.ok(failure, "expected an HTTP failure to translate");
console.log("   适配器翻译失败 →", JSON.stringify({ code: failure.code, message: failure.message }));

const harness = await createHarness(SECTION);
try {
	console.log("② 把失败喂给插件 failover waterfall…");
	const agent = makeAgent("sub-live");
	const action = await dispatchRequestError(harness.root, agent, failure);
	console.log("   → failover 返回", JSON.stringify(action));
	assert.deepEqual(action, { kind: "retry" });

	const config = await dispatchRequest(harness.root, agent, {
		provider: "mock-local",
		model: FAIL_MODEL
	});
	console.log("③ 插件切换模型 →", JSON.stringify(config));
	assert.deepEqual(config, { provider: "mock-local", model: OK_MODEL });

	console.log("④ 真实调用 ok 模型:", OK_MODEL);
	const okCall = await callChat(config.model);
	console.log(`   → HTTP ${okCall.status}`, `"${okCall.body?.choices?.[0]?.message?.content ?? ""}"`);
	assert.equal(okCall.status, 200, "expected the ok model to return 200");
	assert.match(okCall.body?.choices?.[0]?.message?.content ?? "", /Mock reply/);

	console.log("\n✅ 全链路通过：真实 429 失败 → 插件切换 → 真实 200 成功");
} finally {
	await harness.fiber.dispose();
	await harness.root.fiber.dispose();
}