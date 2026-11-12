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

test("random strategy picks a model from the pool, never the one that just failed", async () => {
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
		// The model must be one of the entries in the pool, and NOT the served
		// route: a random pick that repeats the failing entry makes
		// `model.select()` a no-op (it compares equal and appends nothing).
		assert.ok(["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-reasoner"].includes(config.model));
		assert.notStrictEqual(config.model, "deepseek-v4-pro");
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

test("0.2.2: a refused select() does not retire the candidate or spend the pool", async (t) => {
	// Bookkeeping must follow a selection that actually LANDED. Recording the
	// switch first meant a refused `select()` still incremented `count` and
	// marked the step as handled: the pool entry was retired without ever being
	// used, and the step stopped retrying it.
	const harness = await createHarness({
		...SECTION_WITH_MODELS,
		models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-lite"]
	});
	try {
		const agent = makeStepRouteAgent("sub-1", { selectThrows: new Error("model/selection rejected") });
		await dispatchRequestError(harness.root, agent, { step: 1 });
		assert.deepEqual(agent.selections, [], "a refused selection recorded nothing");

		// The host now accepts the call: the SAME step must still be able to pick
		// the entry that was never really taken.
		let attempts = 0;
		agent.model.select = (selection) => {
			attempts += 1;
			agent.selections.push(selection);
		};
		await dispatchRequestError(harness.root, agent, { step: 1 });
		assert.equal(attempts, 1, "the refused attempt must not have consumed the step");
		assert.deepEqual(agent.selections, [{ provider: "deepseek-official", model: "deepseek-v4-flash" }]);
	} finally {
		await disposeHarness(harness);
	}
});

// ── auto-continuation after a switch (2.2.3) ────────────────────────────────
//
// THE FAILURE THESE COVER. `agent.model.select()` only affects the NEXT step
// preparation. A one-shot subagent never starts one, so without a wake the pool
// switches to a healthy route that is never used and the child's task simply
// ends. Measured live before this existed: minmax returned 429 (quota), failover
// selected the healthy entry, and the child still ended `error` with no further
// request.

/** An agent that records `followup` calls, as the host's continuable children do. */
function makeContinuableAgent(id, options = {}) {
	const agent = makeStepRouteAgent(id, options);
	agent.followups = [];
	agent.followup = (message) => { agent.followups.push(message); };
	// The real host exposes a per-agent Cordis context. The wake subscribes to
	// `agent/status` and fires when the agent goes idle — after the failed turn
	// has retired and outside any session append (a `turn/end` listener would be
	// rejected by the store's reentrancy guard, see lib/index.js). This fixture
	// records listeners so a test can emit that transition deterministically.
	const listeners = new Map();
	agent.ctx = {
		on(name, handler) {
			const set = listeners.get(name) ?? new Set();
			set.add(handler);
			listeners.set(name, set);
			return () => set.delete(handler);
		}
	};
	agent.emitSession = (session, event) => {
		for (const handler of [...(listeners.get("session/event") ?? [])]) handler(session, event);
	};
	// The wake listens on `agent/status`, not `session/event`.
	agent.emitStatus = (payload) => {
		for (const handler of [...(listeners.get("agent/status") ?? [])]) handler(payload);
	};
	return agent;
}

/**
 * Emit the idle transition that releases the queued wake.
 *
 * `turn` is accepted (and ignored) so existing tests read naturally: the wake
 * no longer keys on a turn number, it keys on the agent going idle.
 */
function finishTurn(agent, _turn = 1) {
	agent.inbox = agent.inbox ?? { nextTurn: [], nextStep: [] };
	// The host emits `agent/status` only on a TRANSITION (setPhase compares
	// before/after). Model the real sequence: the failed step is running, and
	// `kick()`'s finally moves it to idle — that transition is the wake trigger.
	agent.status = "running";
	agent.emitStatus({ status: "running" });
	agent.status = "idle";
	agent.emitStatus({ status: "idle" });
}

/** Let pending microtasks/macrotasks settle (fallback timer path). */
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

test("a switched subagent is woken for a continuation turn", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeContinuableAgent("sub-continue");
		await dispatchRequestError(harness.root, agent, {
			failure: { message: "429 quota", code: "QUOTA" }
		});
		// Queued on the agent's `agent/status` transition to idle: after the failed
		// turn's `turn/end` committed (which clears the host's `failureAt`), and
		// outside any session append (a `turn/end` listener is rejected).
		finishTurn(agent);
		await tick();
		assert.strictEqual(agent.followups.length, 1);
		// The wake must be this plugin's own source, never "user": a transcript
		// must not present it as something the human typed.
		assert.strictEqual(agent.followups[0].source.kind, "plugin:dsh-subagent-default-model");
	} finally {
		await disposeHarness(harness);
	}
});

test("an exhausted pool never wakes the child (the next turn would be the same dead route)", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeContinuableAgent("sub-exhausted");
		// Two entries => at most ONE switch. Each failure must be a DIFFERENT step,
		// otherwise the per-step guard swallows failures 2 and 3 before the pool
		// guard is ever consulted — which made an earlier version of this test pass
		// even with the exhaustion guard deleted.
		await dispatchRequestError(harness.root, agent, { turn: 1, step: 1, failure: { message: "429", code: "RATE_LIMIT" } });
		finishTurn(agent, 1);
		await tick();
		assert.strictEqual(agent.followups.length, 1, "the single allowed switch wakes once");

		await dispatchRequestError(harness.root, agent, { turn: 2, step: 1, failure: { message: "429", code: "RATE_LIMIT" } });
		finishTurn(agent, 2);
		await tick();
		assert.strictEqual(agent.followups.length, 1, "the pool is exhausted: no further wake");

		await dispatchRequestError(harness.root, agent, { turn: 3, step: 1, failure: { message: "429", code: "RATE_LIMIT" } });
		finishTurn(agent, 3);
		await tick();
		assert.strictEqual(agent.followups.length, 1);
	} finally {
		await disposeHarness(harness);
	}
});

test("the main agent is never woken, even on an eligible failure code", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeContinuableAgent("main", { origin: "root" });
		await dispatchRequestError(harness.root, agent, { failure: { message: "429", code: "QUOTA" } });
		finishTurn(agent);
		await tick();
		assert.strictEqual(agent.followups.length, 0);
	} finally {
		await disposeHarness(harness);
	}
});

test("a fork child is never woken: its inherited prefix would be billed again", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeContinuableAgent("forked");
		// `isSeeded` is the only durable proof of a fork-inherited prefix.
		agent.session.header.isSeeded = true;
		await dispatchRequestError(harness.root, agent, { failure: { message: "429", code: "QUOTA" } });
		finishTurn(agent);
		await tick();
		assert.strictEqual(agent.followups.length, 0);
	} finally {
		await disposeHarness(harness);
	}
});

test("continueAfterFailover: false restores the switch-without-wake behaviour", async () => {
	const harness = await createHarness({ ...SECTION_WITH_MODELS, continueAfterFailover: false });
	try {
		const agent = makeContinuableAgent("sub-off");
		await dispatchRequestError(harness.root, agent, { failure: { message: "429", code: "QUOTA" } });
		finishTurn(agent);
		await tick();
		assert.strictEqual(agent.followups.length, 0);
	} finally {
		await disposeHarness(harness);
	}
});

test("a failure code that is not failover-eligible never wakes the child", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeContinuableAgent("sub-invalid");
		await dispatchRequestError(harness.root, agent, {
			failure: { message: "400 bad request", code: "INVALID_REQUEST" }
		});
		finishTurn(agent);
		await tick();
		assert.strictEqual(agent.followups.length, 0);
	} finally {
		await disposeHarness(harness);
	}
});

test("a child that is already running again is not woken a second time", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeContinuableAgent("sub-racing");
		// Somebody already queued the child's next turn, so a second wake would
		// stack a duplicate intent on top of theirs.
		agent.inbox = { nextTurn: [{}], nextStep: [] };
		await dispatchRequestError(harness.root, agent, { failure: { message: "429", code: "QUOTA" } });
		finishTurn(agent);
		await tick();
		assert.strictEqual(agent.followups.length, 0);
	} finally {
		await disposeHarness(harness);
	}
});

test("maxAutoContinues: 0 disables the wake entirely", async () => {
	const harness = await createHarness({ ...SECTION_WITH_MODELS, maxAutoContinues: 0 });
	try {
		const agent = makeContinuableAgent("sub-capped");
		await dispatchRequestError(harness.root, agent, { failure: { message: "429", code: "QUOTA" } });
		finishTurn(agent);
		await tick();
		assert.strictEqual(agent.followups.length, 0);
	} finally {
		await disposeHarness(harness);
	}
});

test("a RUNNING status at failure time does not suppress the wake (the host fires inside the failed step)", async () => {
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeContinuableAgent("sub-running");
		// Measured on the real host: `agent/request-error` runs while the failed
		// step is still the active phase, so status is "running" on every failure.
		agent.status = "running";
		await dispatchRequestError(harness.root, agent, { failure: { message: "429", code: "QUOTA" } });
		finishTurn(agent);
		await tick();
		assert.strictEqual(agent.followups.length, 1);
	} finally {
		await disposeHarness(harness);
	}
});

// ── random strategy must never re-pick the failing route (2.2.3) ────────────
//
// MEASURED BUG. `nextFailoverIndex` returned a bare
// `Math.floor(Math.random() * entries.length)` for `strategy: "random"`: it
// ignored both `tried` and the route that had just failed. When it picked the
// dead entry again, `model.select()` compared the "new" selection with the
// current one, found them equal and returned WITHOUT appending
// `model/selection` — the switch did nothing, the continuation turn re-requested
// the same dead route, and the child failed again. The live diagnostic read:
//
//   selecting minmax/MiniMax-M3.1-Flash (before=minmax/MiniMax-M3.1-Flash)
//   after select, current() unchanged, seq unchanged
//
// These tests pin the contract that a random pick is always a USEFUL pick.

const RANDOM_TWO = {
	provider: "deepseek-official",
	models: ["deepseek-v4-pro", "deepseek-v4-flash"],
	strategy: "random",
	failoverEnabled: true
};

test("random: never selects the route that just failed (repeated)", async () => {
	const harness = await createHarness(RANDOM_TWO);
	try {
		// 200 independent runs: a 1/2 chance of picking the dead route would show
		// up immediately, and this is deterministic enough to be a real guard.
		for (let run = 0; run < 200; run += 1) {
			const agent = makeStepRouteAgent(`rand-${run}`);
			await dispatchRequestError(harness.root, agent, {
				provider: "deepseek-official",
				failure: { message: "429", code: "RATE_LIMIT" }
			});
			assert.strictEqual(agent.selections.length, 1);
			// The served route is deepseek-v4-pro; the pick must be the other one.
			assert.strictEqual(agent.selections[0].model, "deepseek-v4-flash");
		}
	} finally {
		await disposeHarness(harness);
	}
});

test("random: a pool of three still avoids the served route", async () => {
	const harness = await createHarness({
		provider: "p",
		models: ["a", "b", "c"],
		strategy: "random",
		failoverEnabled: true
	});
	try {
		for (let run = 0; run < 100; run += 1) {
			const agent = makeStepRouteAgent(`rand3-${run}`, { provider: "p", model: "a" });
			await dispatchRequestError(harness.root, agent, { provider: "p", failure: { message: "x", code: "RATE_LIMIT" } });
			assert.strictEqual(agent.selections.length, 1);
			assert.notStrictEqual(agent.selections[0].model, "a");
		}
	} finally {
		await disposeHarness(harness);
	}
});

test("random: later rounds never re-pick the ORIGINAL failing route", async () => {
	// MEASURED HOLE. `tried` only records SELECTED entries, so the route that
	// failed FIRST is never in it. An earlier version excluded the served route
	// only while `tried` was still empty, so round 2 onward could pick that
	// original dead route again — reproduced at ~50% with a three-entry pool.
	const harness = await createHarness({
		provider: "p",
		models: ["a", "b", "c"],
		strategy: "random",
		failoverEnabled: true
	});
	try {
		for (let run = 0; run < 100; run += 1) {
			const agent = makeStepRouteAgent(`rand-rounds-${run}`, { provider: "p", model: "a" });
			// Failure 1: served = "a"; the pick must not be "a".
			await dispatchRequestError(harness.root, agent, { provider: "p", failure: { message: "x", code: "RATE_LIMIT" } });
			assert.strictEqual(agent.selections.length, 1);
			assert.notStrictEqual(agent.selections[0].model, "a", "round 1 must not re-pick the served route");

			// Failure 2 must be a DIFFERENT step: the per-step guard treats two
			// failures inside one step as a single switch. The fixture's route
			// follows the selection, mirroring the host's own fold.
			agent.session.requestContext = () => ({ provider: "p", model: agent.selections.at(-1)?.model ?? "a" });
			await dispatchRequestError(harness.root, agent, { step: 2, provider: "p", failure: { message: "x", code: "RATE_LIMIT" } });
			assert.strictEqual(agent.selections.length, 2);
			assert.notStrictEqual(agent.selections[1].model, "a", "round 2 must not resurrect the original dead route");
			assert.notStrictEqual(agent.selections[1].model, agent.selections[0].model, "round 2 must not repeat round 1's pick");
		}
	} finally {
		await disposeHarness(harness);
	}
});

test("maxAutoContinues is a PER-RUN budget, not a per-turn one", async () => {
	// MEASURED BUG. The engine used to delete its bookkeeping entry on every
	// `agent/pre-step`, i.e. at the start of each continuation turn, restarting
	// the budget. With `maxAutoContinues: 1` a run still queued a second
	// continuation — the documented ceiling was inert.
	//
	// Three routes, and the second failure arrives in a genuine CONTINUATION TURN
	// (turn 2, step 1). With a 2-entry pool the pool guard would intercept it
	// before `onSwitched` ran, which made an earlier version of this test pass
	// even with the pre-step reset reintroduced.
	const harness = await createHarness({
		provider: "p",
		models: ["a", "b", "c", "d"],
		strategy: "round-robin",
		failoverEnabled: true,
		maxAutoContinues: 2
	});
	try {
		const agent = makeContinuableAgent("sub-cap-run", { provider: "p", model: "a" });
		await dispatchRequestError(harness.root, agent, { turn: 1, step: 1, provider: "p", failure: { message: "x", code: "QUOTA" } });
		finishTurn(agent, 1);
		await tick();
		assert.strictEqual(agent.followups.length, 1, "the first wake is used");

		// Turn 2 is the continuation turn; its failure must NOT buy a second wake.
		agent.inbox = { nextTurn: [], nextStep: [] };
		agent.session.requestContext = () => ({ provider: "p", model: agent.selections.at(-1)?.model ?? "a" });
		agent.model.current = () => ({ provider: "p", model: agent.selections.at(-1)?.model ?? "a" });
		await dispatchRequestError(harness.root, agent, { turn: 2, step: 1, provider: "p", failure: { message: "x", code: "QUOTA" } });
		finishTurn(agent, 2);
		await tick();
		// Count is now 2 of 2, so no further wake is allowed. With a per-turn
		// reset (the old bug) the counter returns to 0 and this becomes 2.
		assert.strictEqual(agent.followups.length, 2, "the second allowed wake is used");

		agent.inbox = { nextTurn: [], nextStep: [] };
		await dispatchRequestError(harness.root, agent, { turn: 3, step: 1, provider: "p", failure: { message: "x", code: "QUOTA" } });
		finishTurn(agent, 3);
		await tick();
		assert.strictEqual(agent.followups.length, 2, "the per-run budget is exhausted and must not reset");
	} finally {
		await disposeHarness(harness);
	}
});


test("apply() installs the auto-continue engine exactly once", async () => {
	// MEASURED BUG. `installFailover` also called `installAutoContinue` at its
	// end (a leftover from the refactor that replaced the timer with a callback),
	// so TWO engines were constructed: two `agent/pre-step` wrappers and two
	// `agent/disposed` listeners, with the first engine's `onSwitched` discarded.
	const root = new Context();
	root.provide("subagents", {
		async start(name, request) { return { name, request }; },
		async startContinuable(spec) { return spec; }
	});
	const registered = [];
	const originalOn = root.on.bind(root);
	root.on = (name, ...rest) => { registered.push(name); return originalOn(name, ...rest); };
	await root[Symbol.for("cordis.init")]?.();
	const fiber = root.registry.plugin(defaultModelPlugin, SECTION_WITH_MODELS);
	await fiber;
	try {
		// The route-context injector registers its own pre-step, so the count is
		// two when exactly one auto-continue engine is mounted.
		// One auto-continue engine + the failover waterfall + the route-context
		// injector = three `agent/disposed` cleanup listeners. A second
		// `installAutoContinue` would make it four.
		assert.strictEqual(registered.filter((n) => n === "agent/disposed").length, 3);
		// Exactly one failure waterfall: the auto-continue engine hooks the
		// request-error feed only through the callback the failover path invokes.
		assert.strictEqual(registered.filter((n) => n === "agent/request-error").length, 1);
	} finally {
		await fiber.dispose();
		await root.fiber.dispose();
	}
});

test("a pool of DUPLICATE routes is not a switchable pool", async () => {
	// `AgentModel.select()` is a silent no-op when the new selection equals the
	// recorded one, so a pool like ["a","a"] would switch to the same dead route,
	// record a switch, and wake the child for nothing.
	const harness = await createHarness({ provider: "p", models: ["a", "a"], strategy: "round-robin", failoverEnabled: true });
	try {
		const agent = makeContinuableAgent("sub-dup", { provider: "p", model: "a" });
		await dispatchRequestError(harness.root, agent, { provider: "p", failure: { message: "x", code: "RATE_LIMIT" } });
		await tick();
		assert.strictEqual(agent.selections.length, 0, "no distinct candidate exists, so no selection is attempted");
		assert.strictEqual(agent.followups.length, 0, "and the child is not woken for a route it is already on");
	} finally {
		await disposeHarness(harness);
	}
});

test("an effort-only pool switches to the OTHER effort, not the one it is on", async () => {
	// MEASURED. `session.requestContext()` carries no `reasoningEffort`, so
	// locating the served entry by provider+model alone resolved to the wrong
	// entry and the picker returned the effort the child was ALREADY on.
	// `AgentModel.select()` compares effort, so that selection is a silent no-op
	// — a wasted wake on the dead route. The child here is on `low`.
	const harness = await createHarness({
		models: [
			{ provider: "p", model: "a", reasoningEffort: "high" },
			{ provider: "p", model: "a", reasoningEffort: "low" }
		],
		strategy: "round-robin",
		failoverEnabled: true
	});
	try {
		const agent = makeContinuableAgent("sub-effort", { provider: "p", model: "a" });
		agent.options.reasoningEffort = "low";
		agent.model.current = () => ({ provider: "p", model: "a", reasoningEffort: "low" });
		await dispatchRequestError(harness.root, agent, { provider: "p", failure: { message: "x", code: "RATE_LIMIT" } });
		assert.strictEqual(agent.selections.length, 1);
		assert.strictEqual(agent.selections[0].reasoningEffort, "high", "must not re-select the effort it is already running");
	} finally {
		await disposeHarness(harness);
	}
});

test("a host without a per-agent context reports instead of arming nothing", async () => {
	// Every host in the peer range exposes `agent.ctx`, so this arm is
	// unreachable in practice. It exists so a future host that drops it fails
	// LOUDLY rather than disabling the feature with no trace — and so the budget
	// is refunded instead of being silently spent on a wake that cannot happen.
	const harness = await createHarness(SECTION_WITH_MODELS);
	try {
		const agent = makeContinuableAgent("sub-noctx");
		delete agent.ctx;
		await dispatchRequestError(harness.root, agent, { failure: { message: "x", code: "QUOTA" } });
		finishTurn(agent);
		await tick();
		assert.strictEqual(agent.followups.length, 0, "no wake is possible without a status feed");
		assert.ok(
			harness.warnings.some((line) => line.includes("exposes no per-agent context")),
			"the situation must be reported, not swallowed"
		);
	} finally {
		await disposeHarness(harness);
	}
});


test("a SUPPRESSED wake does not spend the run's continuation budget", async () => {
	// The budget used to be charged BEFORE the inbox guard, so a wake that was
	// suppressed (somebody had already queued the child's next turn) still burned
	// one of the allowed continuations.
	//
	// Same agent, same run, so the budget ledger is shared: a fresh agent would
	// trivially pass and prove nothing.
	// Three routes so the second failure can still switch (the pool guard allows
	// `entries.length - 1` switches, and the first failure already spent one).
	const harness = await createHarness({
		provider: "p",
		models: ["a", "b", "c"],
		strategy: "round-robin",
		failoverEnabled: true,
		maxAutoContinues: 1
	});
	try {
		const agent = makeContinuableAgent("sub-suppressed", { provider: "p", model: "a" });
		agent.inbox = { nextTurn: [{}], nextStep: [] }; // already queued -> suppressed
		await dispatchRequestError(harness.root, agent, { step: 1, failure: { message: "x", code: "QUOTA" } });
		finishTurn(agent, 1);
		await tick();
		assert.strictEqual(agent.followups.length, 0, "suppressed as expected");

		// Drain the queue and force a second failure on a LATER step. Reset the
		// failover bookkeeping so the pool guard is not what blocks this.
		agent.inbox = { nextTurn: [], nextStep: [] };
		// A later turn: the per-turn/per-step guard must not treat this as the
		// same failure as the one above.
		await dispatchRequestError(harness.root, agent, { turn: 2, step: 5, failure: { message: "x", code: "QUOTA" } });
		finishTurn(agent, 2);
		await tick();
		assert.strictEqual(
			agent.followups.length,
			1,
			"the suppressed wake must not have consumed the single allowed continuation"
		);
	} finally {
		await disposeHarness(harness);
	}
});

