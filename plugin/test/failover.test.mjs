import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import * as defaultModelPlugin from "../lib/index.js";

// DSH 0.1.7 settings model: the plugin's `Config` IS the settings section, so
// the harness passes the section straight to `apply(ctx, config)`. The old
// `SettingsProvider` / `settings.publish()` path no longer exists on 0.1.7.
async function createHarness(config = undefined) {
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

	// Capture warnings so the AUTH contract can be asserted, not merely implied.
	// Allowing an AUTH switch is only acceptable because it stays VISIBLE: a
	// silent reroute around a broken key would hide a real misconfiguration.
	const warnings = [];
	if (root.logger !== undefined) {
		root.logger.warn = (...args) => {
			warnings.push(args.map((a) => String(a)).join(" "));
		};
	}

	await root[Symbol.for("cordis.init")]?.();
	const fiber = root.registry.plugin(defaultModelPlugin, config);
	await fiber;

	return { root, config, subagents, fiber, warnings };
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

/**
 * An agent from a DSH 0.2.2+ host.
 *
 * `agent.model` (absent before 0.2.2) is the capability the plugin probes: on
 * these hosts the step's route is fixed and `agent/request` must return it
 * unchanged, so the only lever is `agent.model.select()`, read at the NEXT
 * step's preparation. `selections` records every call so a test can assert the
 * chosen route instead of assuming it.
 */
function makeStepRouteAgent(id, { origin = "subagent", provider = "deepseek-official", model = "deepseek-v4-pro", selectThrows = undefined } = {}) {
	const agent = makeAgent(id, { origin, provider, model });
	const selections = [];
	agent.selections = selections;
	agent.model = {
		select(selection) {
			if (selectThrows !== void 0) throw selectThrows;
			selections.push(selection);
		}
	};
	return agent;
}

/** Drive one `agent/request-error` waterfall (the loop's dispatch). */
function dispatchRequestError(ctx, agent, { turn = 1, step = 1, provider = "deepseek-official", failure = { message: "boom", code: "RATE_LIMIT" }, downstream = undefined } = {}) {
	return ctx.waterfall("agent/request-error", {
		agent,
		turn,
		step,
		provider,
		failure,
		signal: new AbortController().signal
	}, () => Promise.resolve(downstream));
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
		provider: "deepseek-official",
		model: "deepseek-v4-pro",
		models: ["deepseek-v4-pro", "deepseek-v4-flash"],
		strategy: "round-robin",
		failoverEnabled: true
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
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: ["deepseek-v4-pro", "deepseek-v4-flash"],
			failoverEnabled: false
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
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: ["deepseek-v4-pro"],
			failoverEnabled: true
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
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: [],
			failoverEnabled: true
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
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: []
	});
	try {
		const agent = makeAgent("sub-no-failover");
		assert.strictEqual(await dispatchRequestError(harness.root, agent), undefined);
	} finally {
		await disposeHarness(harness);
	}
});

// ── error-code matching ─────────────────────────────────────────────────────

test("connection codes AND auth codes trigger the switch; other codes do not", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		// AUTH now switches: with per-provider keys, one bad key must not kill the
		// delegation while healthy providers sit unused. (It used to be excluded.)
		const authAgent = makeAgent("sub-code-auth");
		assert.deepEqual(
			await dispatchRequestError(harness.root, authAgent, {
				failure: { message: "bad key", code: "AUTH" }
			}),
			{ kind: "retry" },
			"AUTH must switch (a broken key on one provider is not fatal to the pool)"
		);
		// And the switch must be LOUD: silently rerouting around a bad key would
		// hide the real, fixable misconfiguration.
		const authWarning = harness.warnings.find((w) => w.includes("credentials"));
		assert.ok(authWarning, "an AUTH switch must emit the credentials warning");
		assert.match(authWarning, /API key is likely invalid/, "the warning must name the likely cause");
		assert.match(authWarning, /ds41|deepseek-official|workbuddy/, "the warning must name the failing provider");

		// INVALID_CREDENTIAL is the host's own code for the same class.
		const credAgent = makeAgent("sub-code-cred");
		assert.deepEqual(
			await dispatchRequestError(harness.root, credAgent, {
				failure: { message: "blank key", code: "INVALID_CREDENTIAL" }
			}),
			{ kind: "retry" },
			"INVALID_CREDENTIAL must switch too"
		);

		// Codes that are genuinely NOT ours to route around stay untouched: they
		// are not transport/credential problems, so another provider would fail
		// identically and switching would only bury the error.
		for (const code of ["NO_ADAPTER", "CONTEXT_WINDOW_EXCEEDED", "IMAGE_OFFLOAD_REQUIRED"]) {
			const agent = makeAgent(`sub-code-${code}`);
			const ignored = await dispatchRequestError(harness.root, agent, {
				failure: { message: "nope", code }
			});
			assert.strictEqual(ignored, undefined, `${code} must NOT trigger a switch`);
			// No pending switch → the next request stays on the primary.
			assert.deepEqual(
				await dispatchRequest(harness.root, agent, { provider: "deepseek-official", model: "deepseek-v4-pro" }),
				{ provider: "deepseek-official", model: "deepseek-v4-pro" }
			);
		}
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
			provider: "deepseek-official",
			model: "deepseek-v4-pro",
			models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-reasoner"],
			strategy: "random",
			failoverEnabled: true
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
		// Neither entry in SECTION_WITH_MODELS declares its own effort, so the
		// inherited level must be dropped rather than carried onto the fallback.
		assert.deepEqual(config, { provider: "deepseek-official", model: "deepseek-v4-flash" });
	} finally {
		await disposeHarness(harness);
	}
});

test("applies the target entry's own reasoning effort when switching models", async () => {
	// Regression: the fallback used to be dispatched with the inherited effort
	// dropped and nothing put back, so a target whose config declares an effort
	// was called with the previous route's thinking mode. Providers that require
	// the thinking level to agree with the effort answered 400 "invalid thinking
	// type, only be disabled when reasoning effort is none ..." — and because
	// that code is not a trigger, the whole pool was burned on a request that
	// could never succeed even though a healthy model was configured.
	const harness = await createHarness({
			provider: "workbuddy",
			model: "hy3",
			models: [
				"hy3",
				{ provider: "zzztoken", model: "deepseek-v4-pro", reasoningEffort: "max" }
			],
			strategy: "round-robin",
			failoverEnabled: true
	});
	try {
		const agent = makeAgent("sub-effort-applied", { provider: "workbuddy", model: "hy3" });
		await dispatchRequestError(harness.root, agent, { provider: "workbuddy" });
		const config = await dispatchRequest(harness.root, agent, {
			provider: "workbuddy",
			model: "hy3",
			reasoningEffort: "high"
		});
		assert.deepEqual(config, {
			provider: "zzztoken",
			model: "deepseek-v4-pro",
			reasoningEffort: "max"
		});
	} finally {
		await disposeHarness(harness);
	}
});

test("does not re-select a pool entry this run already switched to", async () => {
	// A three-entry pool so a second switch is actually allowed (a two-entry
	// pool exhausts after one switch by design). The second pick must land on
	// the entry that was never tried, not back on the one that just failed.
	const harness = await createHarness({
			provider: "workbuddy",
			model: "hy3",
			models: [
				"hy3",
				{ provider: "zzztoken", model: "deepseek-v4-pro", reasoningEffort: "max" },
				{ provider: "zzztoken-glm", model: "glm-5.3-flash" }
			],
			strategy: "round-robin",
			failoverEnabled: true
	});
	try {
		const agent = makeAgent("sub-dedup", { provider: "workbuddy", model: "hy3" });
		await dispatchRequestError(harness.root, agent, { provider: "workbuddy" });
		const first = await dispatchRequest(harness.root, agent, {
			provider: "workbuddy",
			model: "hy3",
			reasoningEffort: "high"
		});
		assert.equal(first.model, "deepseek-v4-pro");
		// The fallback fails too: the next pick must avoid deepseek-v4-pro.
		const action = await dispatchRequestError(harness.root, agent, { provider: "zzztoken" });
		assert.deepEqual(action, { kind: "retry" });
		const second = await dispatchRequest(harness.root, agent, first);
		assert.equal(second.provider, "zzztoken-glm");
		assert.equal(second.model, "glm-5.3-flash");
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
// ── DSH 0.2.2+: the step's route is fixed ───────────────────────────────────
//
// 0.2.2 captures the step's selection in `preStep()` and throws if the
// `agent/request` waterfall returns a different provider/model ("... after step
// preparation fixed ..."). The pre-0.2.2 failover did exactly that, so on these
// hosts it did not fail over — it crashed the subagent with a host-internal
// error. The replacement records a route with `agent.model.select()`, which the
// NEXT step preparation reads. These tests pin that contract.

test("0.2.2: a failure the host's own retry recovers does NOT move the route", async (t) => {
	// `dsh-llm-retry` is mounted in the base composition and owns backoff. A
	// transient failure it retries must leave the route alone; switching on a
	// blip would drag the subagent onto another provider for no reason, and —
	// because `select()` persists into the next step — it would do so even after
	// the retry succeeded.
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeStepRouteAgent("sub-1");
		const action = await dispatchRequestError(harness.root, agent, { downstream: { kind: "retry" } });
		assert.deepEqual(action, { kind: "retry" }, "the downstream retry must be honoured");
		assert.deepEqual(agent.selections, [], "a recovered request must not change the route");
	} finally {
		await disposeHarness(harness);
	}
});

test("0.2.2: an unrecovered failure selects the next pool route for the NEXT step", async (t) => {
	// Nothing downstream retries, so this route is why the turn dies. The
	// original error is surfaced (it names the real cause) and the next untried
	// entry is recorded for whatever step or turn comes next.
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeStepRouteAgent("sub-1");
		const action = await dispatchRequestError(harness.root, agent);
		assert.equal(action, undefined, "the real error must surface, not a host-internal guard error");
		assert.deepEqual(agent.selections, [{ provider: "deepseek-official", model: "deepseek-v4-flash" }]);
	} finally {
		await disposeHarness(harness);
	}
});

test("0.2.2: agent/request returns the step's route untouched, so the host guard never fires", async (t) => {
	// The regression this replaces: returning a different provider/model here
	// made the host throw. Whatever the pool state, the seed must come back
	// unchanged on a host that fixes the step's route.
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeStepRouteAgent("sub-1");
		await dispatchRequestError(harness.root, agent);
		const seed = { provider: "deepseek-official", model: "deepseek-v4-pro", maxTokens: 4096 };
		const config = await dispatchRequest(harness.root, agent, seed);
		assert.deepEqual(config, seed, "the step's route must be preserved exactly");
	} finally {
		await disposeHarness(harness);
	}
});

test("0.2.2: a route is selected at most once per step", async (t) => {
	// Re-selecting on every retry of the same step would walk the pool while the
	// step can never use any of it, leaving an arbitrary last entry pending.
	const harness = await createHarness({
		...SECTION_WITH_MODELS,
		models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-lite"]
	});
	try {
		const agent = makeStepRouteAgent("sub-1");
		await dispatchRequestError(harness.root, agent, { step: 1 });
		await dispatchRequestError(harness.root, agent, { step: 1 });
		assert.equal(agent.selections.length, 1, "one switch per step");
		// A later step is a new decision point, so it may select again.
		await dispatchRequestError(harness.root, agent, { step: 2 });
		assert.equal(agent.selections.length, 2, "the next step may pick another entry");
	} finally {
		await disposeHarness(harness);
	}
});

test("0.2.2: the pool still bounds the switches, and exhaustion surfaces the real error", async (t) => {
	const harness = await createHarness(SECTION_WITH_MODELS); // two entries
	try {
		const agent = makeStepRouteAgent("sub-1");
		await dispatchRequestError(harness.root, agent, { step: 1 });
		// entries.length - 1 === 1: the pool is spent.
		const action = await dispatchRequestError(harness.root, agent, { step: 2 });
		assert.equal(action, undefined, "an exhausted pool must not invent a retry");
		assert.equal(agent.selections.length, 1, "no candidate beyond the pool may be selected");
	} finally {
		await disposeHarness(harness);
	}
});

test("0.2.2: a refused select() is reported and never swallows the original failure", async (t) => {
	// If the host exposes `model.select` but rejects the call, the user must
	// still see WHY the subagent died (quota/auth), not a secondary error.
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeStepRouteAgent("sub-1", { selectThrows: new Error("model/selection rejected") });
		const action = await dispatchRequestError(harness.root, agent);
		assert.equal(action, undefined, "the original error must still surface");
		assert.ok(
			harness.warnings.some((line) => line.includes("could not pre-select")),
			`expected a diagnostic about the refused selection, got: ${JSON.stringify(harness.warnings)}`
		);
	} finally {
		await disposeHarness(harness);
	}
});

test("0.2.2: AUTH still switches but stays loudly visible", async (t) => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeStepRouteAgent("sub-1");
		await dispatchRequestError(harness.root, agent, {
			provider: "deepseek-official",
			failure: { message: "unauthorised", code: "AUTH" }
		});
		assert.deepEqual(agent.selections, [{ provider: "deepseek-official", model: "deepseek-v4-flash" }]);
		assert.ok(
			harness.warnings.some((line) => line.includes("credentials") && line.includes("NOT a connection problem")),
			"an auth switch must name the refused credentials"
		);
	} finally {
		await disposeHarness(harness);
	}
});

test("0.2.2: the main agent loop is still never touched", async (t) => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const rootAgent = makeStepRouteAgent("main-agent", { origin: "root" });
		await dispatchRequestError(harness.root, rootAgent);
		assert.deepEqual(rootAgent.selections, [], "the parent loop keeps its route");
	} finally {
		await disposeHarness(harness);
	}
});
