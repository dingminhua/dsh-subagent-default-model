// Local mock LLM server for testing the subagent failover path.
//
// OpenAI-compatible wire API:
//   GET  /v1/models            → list the two configured models
//   POST /v1/chat/completions  → "fail" model returns 429 (RATE_LIMIT);
//                                "ok" model returns a minimal 200 completion.
//
// Purpose: point a custom DSH provider at this server, configure the plugin
// with two routes, and watch failover switch the subagent from the failing
// model to the working one (a "当前供应商/模型" row appears in the trajectory).
//
// Usage:
//   node plugin/scripts/mock-llm-server.mjs [port]
// (default port 8799)
//
// Behavior (override via env):
//   MOCK_FAIL_MODEL   model id that always fails  (default "deepseek-v4-pro")
//   MOCK_OK_MODEL     model id that always works  (default "deepseek-v4-flash")
//   MOCK_FAIL_CODE    HTTP status for the fail model (default 429)
//   MOCK_FAIL_CODEID  DSH failure code (default "RATE_LIMIT")

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8799);
const failModel = process.env.MOCK_FAIL_MODEL ?? "deepseek-v4-pro";
const okModel = process.env.MOCK_OK_MODEL ?? "deepseek-v4-flash";
const failCode = Number(process.env.MOCK_FAIL_CODE ?? 429);
const failCodeId = process.env.MOCK_FAIL_CODEID ?? "RATE_LIMIT";
// MOCK_ALL_FAIL=1 → every model (including the "ok" one) returns the failure.
// Use it to observe failover pool exhaustion: every candidate fails, the pool
// is exhausted, and the task ends with a real error instead of looping forever.
const allFail = process.env.MOCK_ALL_FAIL === "1";

const MODELS = [
	{ id: failModel, object: "model", owned_by: "mock" },
	{ id: okModel, object: "model", owned_by: "mock" }
];

function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
	res.end(payload);
}

/**
 * OpenAI-compatible streaming response (SSE). DSH requests streams by default,
 * so the "ok" model MUST answer in `text/event-stream` — a plain JSON 200 is
 * parsed as a malformed stream and fails with "Stream ended without finish_reason".
 */
function sseJson(res, body) {
	res.write(`data: ${JSON.stringify(body)}\n\n`);
}

function streamCompletion(res, model, reply) {
	const created = Math.floor(Date.now() / 1000);
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive"
	});
	sseJson(res, {
		id: "mock-chat-completion",
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }]
	});
	sseJson(res, {
		id: "mock-chat-completion",
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
	});
	res.write("data: [DONE]\n\n");
	res.end();
}

function readBody(req) {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (chunk) => (data += chunk));
		req.on("end", () => {
			try {
				resolve(data.length ? JSON.parse(data) : {});
			} catch {
				resolve({});
			}
		});
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${port}`);
	if (req.method === "GET" && url.pathname === "/v1/models") {
		return json(res, 200, { object: "list", data: MODELS });
	}
	if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
		const body = await readBody(req);
		const model = typeof body.model === "string" ? body.model : "";
		if (allFail || model === failModel) {
			// Connection-class failure → triggers failover (RATE_LIMIT in the whitelist).
			res.setHeader("retry-after", "1");
			return json(res, failCode, {
				error: { message: "mock rate limit exceeded", code: failCodeId, type: failCodeId }
			});
		}
		// Anything else (the "ok" model, or unknown models) succeeds.
		const reply = `Mock reply from ${model || "unknown"}`;
		if (body.stream !== false) return streamCompletion(res, model, reply);
		return json(res, 200, {
			id: "mock-chat-completion",
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
		});
	}
	return json(res, 404, { error: { message: `not found: ${req.method} ${url.pathname}`, code: "NOT_FOUND" } });
});

server.listen(port, "127.0.0.1", () => {
	console.log(`mock LLM server listening on http://127.0.0.1:${port}`);
	console.log(`  fail model: "${failModel}" → HTTP ${failCode} (${failCodeId})`);
	if (allFail) console.log(`  ALL models fail (MOCK_ALL_FAIL=1) → HTTP ${failCode} (${failCodeId})`);
	else console.log(`  ok   model: "${okModel}"  → HTTP 200`);
});
