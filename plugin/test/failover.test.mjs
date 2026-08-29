import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { SettingsProvider } from "@deepseek-ai/dsh-settings";
import * as defaultModelPlugin from "../lib/index.js";

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
	const subagents = {
		async start(name, request) {
			return { name, request };
		},
		async startContinuable(spec) {
			return spec;
		}
	};
	root.provide("subagents", subagents);

	const settings = new MemorySettings(root, document);
	await settings.load().then((loaded) => settings.publish(loaded));
	await root[Symbol.for("cordis.init")]?.();
	const fiber = root.registry.plugin(defaultModelPlugin);
	await fiber;

	return { root, settings, subagents, fiber };
}

async function disposeHarness(harness) {
	await harness.fiber.dispose();
	await harness.root.fiber.dispose();
}

// ── fake agent + dispatch drivers (mirror the agent-loop waterfalls) ────────

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

/** Drive one `agent/request-error` waterfall (the loop's dispatch). */
function dispatchRequestError(ctx, agent, { turn = 1, step = 1, provider = "deepseek-official", failure = { message: "boom", code: "RATE_LIMIT" } } = {}) {
	return ctx.waterfall("agent/request-error", {
		agent,
		turn,
		step,
		provider,
		failure,
		signal: new AbortController().signal
	}, () => Promise.resolve(void 0));
}

/** Drive one `agent/request` waterfall (the loop's buildRequest). */
function dispatchRequest(ctx, agent, seed, { turn = 1, step = 1 } = {}) {
	return ctx.waterfall("agent/request", {
		agent,
		turn,
		step,
		signal: new AbortController().signal
	}, () => Promise.resolve(seed));
}

// ── shared test fixtures ────────────────────────────────────────────────────

const SECTION_WITH_MODELS = {
	"subagent-default-model": {
		provider: "deepseek-official",
		model: "deepseek-v4-pro",
		models: ["deepseek-v4-pro", "deepseek-v4-flash"],
		strategy: "round-robin",
		failoverEnabled: true
	}
};

// ── subagent-only gate ──────────────────────────────────────────────────────

test("subagent failover returns retry and switches to the next model in the list", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeAgent("sub-1");
		const action = await dispatchRequestError(harness.root, agent);
		assert.deepEqual(action, { kind: "retry" });

		const seed = { provider: "deepseek-official", model: "deepseek-v4-pro" };
		const config = await dispatchRequest(harness.root, agent, seed);
		assert.deepEqual(config, { provider: "deepseek-official", model: "deepseek-v4-flash" });
	} finally {
		await disposeHarness(harness);
	}
});

test("failover NEVER touches the main (root-origin) agent loop", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const rootAgent = makeAgent("main-agent", { origin: "root" });
		const action = await dispatchRequestError(harness.root, rootAgent);
		assert.strictEqual(action, undefined);

		const seed = { provider: "deepseek-official", model: "deepseek-v4-pro" };
		const config = await dispatchRequest(harness.root, rootAgent, seed);
		assert.deepEqual(config, seed);
	} finally {
		await disposeHarness(harness);
	}
});

test("failover is inert when failoverEnabled is false", async () => {
	const harness = await createHarness({
		"subagent-default-model": {
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: ["deepseek-v4-pro", "deepseek-v4-flash"],
			failoverEnabled: false
		}
	});
	try {
		const agent = makeAgent("sub-disabled");
		assert.strictEqual(await dispatchRequestError(harness.root, agent), undefined);
	} finally {
		await disposeHarness(harness);
	}
});

test("failover is inert when the models list has fewer than 2 entries", async () => {
	const harness = await createHarness({
		"subagent-default-model": {
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: ["deepseek-v4-pro"],
			failoverEnabled: true
		}
	});
	try {
		const agent = makeAgent("sub-single");
		assert.strictEqual(await dispatchRequestError(harness.root, agent), undefined);
	} finally {
		await disposeHarness(harness);
	}
});

test("failover is inert when the models list is empty", async () => {
	const harness = await createHarness({
		"subagent-default-model": {
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: [],
			failoverEnabled: true
		}
	});
	try {
		const agent = makeAgent("sub-empty");
		assert.strictEqual(await dispatchRequestError(harness.root, agent), undefined);
	} finally {
		await disposeHarness(harness);
	}
});

test("failover is inert when the failoverEnabled field is absent (defaults to true but models empty)", async () => {
	const harness = await createHarness({
		"subagent-default-model": {
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: []
		}
	});
	try {
		const agent = makeAgent("sub-no-failover");
		assert.strictEqual(await dispatchRequestError(harness.root, agent), undefined);
	} finally {
		await disposeHarness(harness);
	}
});

// ── error-code matching ─────────────────────────────────────────────────────

test("only connection-failure codes trigger the switch", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeAgent("sub-code");
		const ignored = await dispatchRequestError(harness.root, agent, {
			failure: { message: "bad key", code: "AUTH" }
		});
		assert.strictEqual(ignored, undefined);

		// No pending switch → next request stays on the primary.
		const config = await dispatchRequest(harness.root, agent, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
		assert.deepEqual(config, { provider: "deepseek-official", model: "deepseek-v4-pro" });
	} finally {
		await disposeHarness(harness);
	}
});

// ── pool exhaustion under round-robin ───────────────────────────────────────

test("round-robin: walks the pool and passes through when exhausted", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeAgent("sub-rr");

		// Failure 1 → switches to deepseek-v4-flash (index 1)
		assert.deepEqual(await dispatchRequestError(harness.root, agent, { step: 1 }), { kind: "retry" });
		// Failure 2 → the fallback also failed; pool exhausted → surface (no retry)
		assert.strictEqual(await dispatchRequestError(harness.root, agent, { step: 2 }), undefined);

		// The already-applied switch stays in effect for the rest of the run:
		// the loop surfaced the error, so this request would never happen, but
		// the pending fallback is intentionally NOT reset to the primary.
		const config = await dispatchRequest(harness.root, agent, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
		assert.deepEqual(config, { provider: "deepseek-official", model: "deepseek-v4-flash" });
	} finally {
		await disposeHarness(harness);
	}
});

// ── random strategy ─────────────────────────────────────────────────────────

test("random strategy picks a model from the pool (no dedup check)", async () => {
	const harness = await createHarness({
		"subagent-default-model": {
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-reasoner"],
			strategy: "random",
			failoverEnabled: true
		}
	});
	try {
		const agent = makeAgent("sub-random");
		const action = await dispatchRequestError(harness.root, agent, { failure: { message: "too busy", code: "SERVER" } });
		assert.deepEqual(action, { kind: "retry" });

		const config = await dispatchRequest(harness.root, agent, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
		// Randomly picked from the 3-entry pool; the provider/model should resolve.
		assert.ok(config.provider !== void 0);
		assert.ok(config.model !== void 0);
		// The model must be one of the entries in the pool.
		assert.ok(["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-reasoner"].includes(config.model));
	} finally {
		await disposeHarness(harness);
	}
});

// ── disposal cleanup ────────────────────────────────────────────────────────

test("clears per-agent failover state on agent/disposed", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeAgent("sub-dispose");
		await dispatchRequestError(harness.root, agent);
		harness.root.emit("agent/disposed", { agent });

		// State cleared → next request stays on the primary.
		const config = await dispatchRequest(harness.root, agent, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
		assert.deepEqual(config, { provider: "deepseek-official", model: "deepseek-v4-pro" });
	} finally {
		await disposeHarness(harness);
	}
});

// ── reasoning effort ────────────────────────────────────────────────────────

test("drops inherited reasoning effort when switching models", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeAgent("sub-effort");
		await dispatchRequestError(harness.root, agent);
		const config = await dispatchRequest(harness.root, agent, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			reasoningEffort: "high"
		});
		assert.deepEqual(config, { provider: "deepseek-official", model: "deepseek-v4-flash" });
	} finally {
		await disposeHarness(harness);
	}
});

// ── sticky within run scope ─────────────────────────────────────────────────

test("stays on the switched model for subsequent steps of the same run", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeAgent("sub-sticky");
		// Fail on step 1 → switch to deepseek-v4-flash (index 1)
		await dispatchRequestError(harness.root, agent, { step: 1 });
		// Step 1 request → fallback model
		await dispatchRequest(harness.root, agent, { provider: "deepseek-official", model: "deepseek-v4-pro" }, { step: 1 });

		// Step 2 request (no new failure) → should ALSO use the fallback (sticky)
		const config2 = await dispatchRequest(harness.root, agent, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		}, { step: 2 });
		assert.deepEqual(config2, { provider: "deepseek-official", model: "deepseek-v4-flash" });
	} finally {
		await disposeHarness(harness);
	}
});