// Behavioural contract for the subagent route-context injection.
//
// WHY THIS EXISTS: the published feature is "the subagent is told, in its own
// context, which provider/model it is actually running on". That claim is only
// true if all of the following hold, each of which is asserted below:
//
//   1. the line reaches the SUBAGENT's message list (not just a UI row),
//   2. it states the route the request ACTUALLY resolved to — including after
//      this plugin's own failover swap, which is why the injector observes the
//      settled `agent/request` seed rather than the plugin's intended target,
//   3. the MAIN agent's context is never touched,
//   4. a route change (failover) REPLACES the stale line instead of stacking a
//      second one, so a long run does not accumulate duplicates,
//   5. disabling the setting stops the injection entirely,
//   6. the message source is producer-owned (`plugin:<name>`) with a `form`
//      marker, because the v4 session format rejects a bare `{kind:"plugin"}`
//      wrapper and would refuse to load the whole session.
//
// The `agent/request` + `agent/pre-step` waterfalls and the `agent.inbox`
// mutations are driven exactly as `dsh-agent-loop` does them:
// `prepend(target, message)` / `remove(messageId)` / `nextStep`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import * as defaultModelPlugin from "../lib/index.js";

// ── harness ─────────────────────────────────────────────────────────────────

/**
 * A faithful stand-in for `dsh-agent-loop`'s Inbox: two pending lists, with
 * `prepend`/`remove` locating messages by identity, exactly like the host.
 */
function makeInbox() {
	const state = { "next-turn": [], "next-step": [] };
	return {
		state,
		get nextStep() {
			return state["next-step"];
		},
		get nextTurn() {
			return state["next-turn"];
		},
		prepend(target, message) {
			state[target].unshift(message);
		},
		remove(messageId) {
			for (const target of ["next-turn", "next-step"]) {
				const index = state[target].findIndex((message) => message.id === messageId);
				if (index >= 0) {
					state[target].splice(index, 1);
					return true;
				}
			}
			return false;
		},
		/**
		 * Drain the pending lists, as the REAL loop does at the top of
		 * `preStep()` — BEFORE the `agent/pre-step` waterfall runs
		 * (`mutate("next-step", 0, this.nextStep.length, [], false)`).
		 *
		 * Modelling this is essential: without it a fixture leaves the previous
		 * step's messages sitting in `nextStep`, which makes an inbox-based
		 * "already injected?" check look like it works. In the real host that
		 * list is always empty by then, and an earlier build re-injected the
		 * route line on EVERY step (28 duplicates in a 29-step subagent).
		 */
		claim() {
			const claimed = state["next-step"].slice();
			state["next-step"].length = 0;
			return claimed;
		}
	};
}

let messageSeq = 0;
function makeAgent(id, { origin = "subagent", seededFrom = void 0 } = {}) {
	// `session.requestContext()` folds the latest committed `request/context`,
	// exactly as the Host session does. The injector treats it as the
	// authoritative LIVE route, so the fixture must model it as a mutable value
	// that `dispatchRequest` advances — a fixed stub would hide route changes
	// (and did hide the stale-route bug this suite now guards).
	//
	// `seededFrom` models a RESTORED session: `Session.fromRestore` starts with
	// the PREVIOUS run's log as its seed, so the fold already answers — with the
	// OLD run's route — before this run has requested anything. The header's
	// `isSeeded` flag is what the injector keys on to distrust that answer.
	let live = seededFrom;
	const agent = recordInjections({
		id,
		inbox: makeInbox(),
		options: { provider: "deepseek-official", model: "deepseek-v4-pro" },
		session: {
			id,
			header: seededFrom === void 0 ? { origin } : { origin, isSeeded: true },
			requestContext: () => live
		}
	});
	/** Commit a `request/context` frame, as the loop does after building one. */
	agent.commitRoute = (route) => {
		live = { provider: route.provider, model: route.model };
	};
	return agent;
}

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
	await root[Symbol.for("cordis.init")]?.();
	const fiber = root.registry.plugin(defaultModelPlugin, config);
	await fiber;
	return { root, fiber, subagents };
}

async function disposeHarness(harness) {
	await harness.fiber.dispose();
	await harness.root.fiber.dispose();
}

/**
 * Drive one `agent/request` waterfall and return the settled seed.
 *
 * Also commits the settled route to the session, because the real loop appends
 * a `request/context` frame for exactly that value — and the injector reads it
 * as the authoritative live route.
 */
async function dispatchRequest(ctx, agent, seed, { turn = 1, step = 1 } = {}) {
	const settled = await ctx.waterfall("agent/request", {
		agent,
		turn,
		step,
		signal: new AbortController().signal
	}, () => Promise.resolve(seed));
	if (settled !== void 0 && settled !== null && typeof settled.provider === "string") {
		agent.commitRoute(settled);
	}
	return settled;
}

/**
 * Drive one `agent/pre-step` waterfall.
 *
 * @returns the decision, so callers can also assert the injector is transparent
 *   (it must not disturb the messages the loop itself assembled).
 */
/**
 * A message that makes a step "real work" the way a user prompt does.
 *
 * A step with an EMPTY message list is the loop's wrap-up `preStep()` after the
 * final answer, and injecting there would defeat its termination test
 * (`turnEnds && decision.messages.length === 0` => break), so the injector skips
 * it by design. Tests that mean "a normal step" therefore must supply at least
 * one message; pass `[]` only when the wrap-up step is the thing under test.
 */
function stepMessage(text = "do the task") {
	return { id: `step-${++messageSeq}`, role: "user", content: [{ type: "text", text }], source: { kind: "user" } };
}

async function dispatchPreStep(ctx, agent, messages = [stepMessage()], { turn = 1, step = 1 } = {}) {
	// Faithful ordering: the real loop CLAIMS (drains) the inbox at the top of
	// `preStep()`, then runs this waterfall. Skipping the claim is what hid the
	// duplicate-injection bug, so it is modelled here by default.
	const claimed = agent.inbox.claim();
	const decision = await ctx.waterfall("agent/pre-step", {
		agent,
		messages: [...claimed, ...messages],
		turn,
		step,
		signal: new AbortController().signal
	}, () => Promise.resolve({ messages: [...claimed, ...messages], kind: "continue" }));
	// The REAL loop calls `step(decision)`, which appends EVERY entry of
	// `decision.messages` to the session as a `user/message` (`firstAttempt`
	// branch). That append is what makes an injected line permanent history for
	// later steps, so the fixture must model it — otherwise "the line is still
	// visible on step 3" could only be faked by re-injecting.
	if (decision && Array.isArray(decision.messages)) {
		for (const message of decision.messages) {
			agent.history.push(message);
			if (isRouteContext(message)) agent.injectedRouteLog.push(message);
		}
	}
	return decision;
}

/** True when a message is this plugin's injected route line. */
function isRouteContext(message) {
	return message?.source?.kind === "plugin:dsh-subagent-default-model"
		&& message.source.form === "route-context";
}

/**
 * Every route line the plugin has DELIVERED to this agent so far.
 *
 * "Delivered" means it was part of a step's `decision.messages` — the array the
 * loop actually sends and then persists. Counting deliveries (not the inbox)
 * is what makes "exactly once" meaningful: the old inbox-based bug shipped 28
 * copies in a 29-step run precisely because a post-claim read could not see it.
 */
function injectedRouteMessages(agent) {
	return agent.injectedRouteLog ?? [];
}

/** Every route line still VISIBLE in the agent's context (persisted history). */
function visibleRouteMessages(agent) {
	return (agent.history ?? []).filter(isRouteContext);
}

/** Give an agent the two ledgers the fixture mirrors from the real loop. */
function recordInjections(agent) {
	agent.injectedRouteLog = [];
	// `step()` appends `decision.messages` to the session; model that as history
	// so "is the line still there on a later step?" is answerable without
	// assuming re-injection.
	agent.history = [];
	return agent;
}

const ENABLED = { injectRouteContext: true };
const DISABLED = { injectRouteContext: false };

// ── 1. the line reaches the subagent's context ──────────────────────────────

test("injects the resolved route into the subagent's own context", async () => {
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-1");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent);

	const injected = injectedRouteMessages(agent);
	assert.equal(injected.length, 1, "exactly one route line is injected");
	const text = injected[0].content[0].text;
	assert.ok(
		text.includes("workbuddy/deepseek-v4.1-flash"),
		`the line must carry the ACTUAL route, got: ${text}`
	);
	assert.equal(injected[0].role, "user", "a context line is a user-role message");
	await disposeHarness(harness);
});

// ── 2. it reports the SETTLED route, not the plugin's intended target ───────

test("reports the route after another waterfall rewrote it (failover-safe)", async () => {
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-2");

	// A later listener swaps the seed to a different vendor, exactly as the
	// plugin's own failover does. The injector must observe the SETTLED value.
	harness.root.on("agent/request", async (payload, next) => {
		const seed = await next();
		return { ...seed, provider: "other-provider", model: "gpt-5.6" };
	});

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent);

	const text = injectedRouteMessages(agent)[0].content[0].text;
	assert.ok(text.includes("other-provider/gpt-5.6"), `must report the settled route, got: ${text}`);
	assert.ok(
		!text.includes("workbuddy/deepseek-v4.1-flash"),
		"must NOT report the pre-swap route"
	);
	await disposeHarness(harness);
});

// ── 3. the main agent's context is never touched ────────────────────────────

test("never injects into the MAIN agent's context", async () => {
	const harness = await createHarness(ENABLED);
	const main = makeAgent("main-1", { origin: "main" });

	await dispatchRequest(harness.root, main, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, main);

	assert.equal(injectedRouteMessages(main).length, 0, "the main agent must stay untouched");
	await disposeHarness(harness);
});

test("the MAIN agent stays untouched across several steps", async () => {
	// The request-side gate keeps the main agent's route out of the cache in the
	// first place; this asserts the observable contract on repeated steps.
	const harness = await createHarness(ENABLED);
	const main = makeAgent("main-2", { origin: "main" });

	for (let step = 1; step <= 3; step += 1) {
		await dispatchRequest(harness.root, main, { provider: "workbuddy", model: "deepseek-v4.1-flash" }, { step });
		await dispatchPreStep(harness.root, main, [], { step });
	}

	assert.equal(injectedRouteMessages(main).length, 0, "no step may inject into the main agent");
	await disposeHarness(harness);
});

test("the origin gate is load-bearing on BOTH waterfalls", async () => {
	// Static contract: the injector must gate the request side AND the pre-step
	// side on `isSubagentAgent`. Mutation-verified — deleting only the pre-step
	// gate silently stops injecting nothing, because the cache is never seeded
	// for a non-subagent; deleting only the request gate leaks the main agent's
	// route into the cache. Requiring both makes either regression fail loudly.
	const source = readFileSync(fileURLToPath(new URL("../lib/index.js", import.meta.url)), "utf8");
	const region = source.slice(source.indexOf("function installRouteContextInjector"));
	const body = region.slice(0, region.indexOf("\nfunction ", 10));
	const gates = body.match(/if \(!isSubagentAgent\(agent\)\) return/g) ?? [];
	assert.equal(
		gates.length,
		2,
		`installRouteContextInjector must gate BOTH the request and pre-step waterfalls, found ${gates.length}`
	);
});

// ── 4. a route change replaces, never stacks ────────────────────────────────

test("a route change REPLACES the stale line instead of accumulating", async () => {
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-3");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent);
	assert.equal(injectedRouteMessages(agent).length, 1, "first route injected once");

	// Failover switches the route and the loop runs another step.
	await dispatchRequest(harness.root, agent, { provider: "other-provider", model: "gpt-5.6" }, { turn: 1, step: 2 });
	await dispatchPreStep(harness.root, agent, [], { turn: 1, step: 2 });

	// The change legitimately places a SECOND line (the first described a route
	// that is no longer in use). What must NOT happen is an unbounded pile-up.
	const injected = injectedRouteMessages(agent);
	assert.equal(injected.length, 2, "one line per distinct route, not one per step");
	assert.ok(
		injected.at(-1).content[0].text.includes("other-provider/gpt-5.6"),
		"the newest line states the CURRENT route"
	);
	await disposeHarness(harness);
});

test("an UNCHANGED route does not re-inject on the next step", async () => {
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-4");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent);
	// Second step, same route: the line the loop already claimed is gone from
	// the inbox, so a naive injector would add a fresh copy. It must not.
	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" }, { step: 2 });
	await dispatchPreStep(harness.root, agent, [], { step: 2 });

	const injected = injectedRouteMessages(agent);
	assert.equal(
		injected.length,
		1,
		`an unchanged route must inject exactly once across steps, got ${injected.length}`
	);
	await disposeHarness(harness);
});

test("REGRESSION: a long single-route run injects exactly once (no per-step pile-up)", async () => {
	// Observed in a REAL host: a 29-step subagent received 28 copies of the same
	// route line. Root cause — the loop's `inbox.claim()` drains `next-step`
	// BEFORE the pre-step waterfall, so an "is a copy still pending?" dedupe is
	// always false and re-injects every step. The dedupe must be out-of-band.
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-long-run");
	const ROUTE = { provider: "workbuddy", model: "deepseek-v4.1-flash" };

	for (let step = 1; step <= 30; step += 1) {
		await dispatchRequest(harness.root, agent, ROUTE, { step });
		await dispatchPreStep(harness.root, agent, [], { step });
	}

	const injected = injectedRouteMessages(agent);
	assert.equal(
		injected.length,
		1,
		`30 steps on one unchanged route must inject ONCE, got ${injected.length} (the shipped bug gave 28/29)`
	);
	await disposeHarness(harness);
});

test("REGRESSION: a mid-run provider switch injects once per route, not per step", async () => {
	// The other half of the same bug: because every step re-injected, the route
	// reported to the model also appeared to churn. Distinct routes must each
	// produce exactly ONE line, and the count must not scale with step count.
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-switch-run");

	// 10 steps on route A.
	for (let step = 1; step <= 10; step += 1) {
		await dispatchRequest(harness.root, agent, { provider: "ds41", model: "deepseek-v4.1-flash" }, { step });
		await dispatchPreStep(harness.root, agent, [], { step });
	}
	// A provider switch, then 10 more steps on route B.
	for (let step = 11; step <= 20; step += 1) {
		await dispatchRequest(harness.root, agent, { provider: "workbuddy-global", model: "deepseek-v4.1-flash" }, { step });
		await dispatchPreStep(harness.root, agent, [], { step });
	}

	const injected = injectedRouteMessages(agent);
	assert.equal(injected.length, 2, `two distinct routes must give two lines, got ${injected.length}`);
	assert.match(injected[0].content[0].text, /ds41\/deepseek-v4\.1-flash/);
	assert.match(injected[1].content[0].text, /workbuddy-global\/deepseek-v4\.1-flash/);
	await disposeHarness(harness);
});

// ── 5. the switch turns it off ──────────────────────────────────────────────

test("injectRouteContext: false disables the injection entirely", async () => {
	const harness = await createHarness(DISABLED);
	const agent = makeAgent("sub-5");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent);

	assert.equal(
		injectedRouteMessages(agent).length,
		0,
		"with the setting off, nothing may be injected"
	);
	await disposeHarness(harness);
});

test("the setting defaults to ON when absent (feature is live out of the box)", async () => {
	const harness = await createHarness({ provider: "deepseek-official", model: "deepseek-v4-pro" });
	const agent = makeAgent("sub-6");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent);

	assert.equal(
		injectedRouteMessages(agent).length,
		1,
		"an absent setting must default to injecting"
	);
	await disposeHarness(harness);
});

// ── 6. session-format safety ────────────────────────────────────────────────

test("the injected source is producer-owned and carry a form marker", async () => {
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-7");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent);

	const source = injectedRouteMessages(agent)[0].source;
	// `assertV4MessageSources` rejects a bare `{kind:"plugin"}` wrapper; the
	// plugin must use `plugin:<package-name>`.
	assert.equal(source.kind, "plugin:dsh-subagent-default-model");
	assert.notEqual(source.kind, "plugin", "a bare 'plugin' kind refuses to load in v4");
	assert.equal(source.form, "route-context", "the form marker is what dedupe/replace keys on");
	await disposeHarness(harness);
});

// ── 7. transparency ─────────────────────────────────────────────────────────

test("the injector does not disturb the loop's own assembled messages", async () => {
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-8");
	const own = [{ id: "loop-own", role: "user", content: [{ type: "text", text: "hello" }] }];

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	const decision = await dispatchPreStep(harness.root, agent, own);

	// The contract is "preserve, then append" — not "return the same array".
	// Dropping or reordering the loop's own messages would corrupt the step; the
	// route line belongs at the END, after the real work it describes.
	assert.deepEqual(
		decision.messages.slice(0, own.length),
		own,
		"the loop's own messages must survive untouched and in order"
	);
	assert.equal(decision.messages.length, own.length + 1, "exactly one line is appended");
	const tail = decision.messages[decision.messages.length - 1];
	assert.ok(isRouteContext(tail), `the appended message must be the route line, got: ${JSON.stringify(tail)}`);
	assert.notStrictEqual(decision.messages, own, "a new array is returned (the loop's array is not mutated)");
	await disposeHarness(harness);
});

test("the FIRST step with no committed route stays SILENT (no stale guess)", async () => {
	// The loop calls preStep() BEFORE buildRequest(), so on step 1 nothing has
	// resolved yet. The ONLY other value available is `agent.options` — the
	// DISPATCH-TIME seed, which the parent may have already superseded.
	//
	// Reporting it is what produced the live contradiction this test guards: a
	// subagent really on `ds41` got a step-1 line saying `glm` (the dispatch
	// seed). Since the line is only a report about reality, a guess that is
	// immediately contradicted is worse than saying nothing — so the injector
	// must stay silent until the route is KNOWN, then inject on the next step.
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-first-step");
	agent.options = { provider: "workbuddy", model: "deepseek-v4.1-flash" };

	// NO dispatchRequest call at all: nothing has committed yet.
	await dispatchPreStep(harness.root, agent);

	assert.equal(
		injectedRouteMessages(agent).length,
		0,
		"an uncommitted route must NOT be guessed from the dispatch-time agent.options"
	);

	// One step later the route is known, and the line lands.
	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent, [], { step: 2 });
	const injected = injectedRouteMessages(agent);
	assert.equal(injected.length, 1, "the line lands as soon as the route is known");
	assert.ok(injected[0].content[0].text.includes("workbuddy/deepseek-v4.1-flash"));
	await disposeHarness(harness);
});

test("REGRESSION: a route switched before the next step is reported correctly, never stale", async () => {
	// The live defect: step 1 built a request on `glm`, the loop then switched
	// to `ds41` in the same step, and step 2 was labelled `glm` — because the
	// injector preferred a lagging source over the session's live fold. The
	// model then saw `glm` and `ds41` side by side, contradicting each other.
	//
	// `agent.options` is deliberately left at the dispatch seed (`glm`) here, to
	// prove the injector ignores it once reality has moved on.
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-stale-route");
	agent.options = { provider: "glm", model: "deepseek-v4.1-flash" };

	// Step 1: two requests — the first on glm, then a switch to ds41.
	await dispatchPreStep(harness.root, agent, [], { step: 1 });
	await dispatchRequest(harness.root, agent, { provider: "glm", model: "deepseek-v4.1-flash" }, { step: 1 });
	await dispatchRequest(harness.root, agent, { provider: "ds41", model: "deepseek-v4.1-flash" }, { step: 1 });

	// Step 2 onward: reality is ds41.
	await dispatchPreStep(harness.root, agent, [], { step: 2 });
	await dispatchPreStep(harness.root, agent, [], { step: 3 });
	await dispatchPreStep(harness.root, agent, [], { step: 4 });

	const injected = injectedRouteMessages(agent);
	assert.equal(injected.length, 1, `exactly one line for one real route, got ${injected.length}`);
	assert.ok(
		injected[0].content[0].text.includes("ds41/deepseek-v4.1-flash"),
		"the line must state the route actually in use"
	);
	assert.ok(
		!injected[0].content[0].text.includes("glm"),
		"the stale dispatch seed must never appear"
	);
	await disposeHarness(harness);
});

test("no route at all injects nothing (no empty/placeholder line)", async () => {
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-9");
	// An agent whose route is genuinely unknown: nothing to report, so the
	// injector must stay silent rather than write a placeholder.
	agent.options = { provider: "", model: "" };

	await dispatchPreStep(harness.root, agent);

	assert.equal(injectedRouteMessages(agent).length, 0, "must not inject a placeholder route");
	await disposeHarness(harness);
});

// ── 8. teardown ─────────────────────────────────────────────────────────────

test("disposal removes the injector (no listener leak)", async () => {
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-10");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent);
	assert.equal(injectedRouteMessages(agent).length, 1);

	await disposeHarness(harness);
	// The agent's route cache is dropped with the fiber: a later pre-step on the
	// disposed plugin must not inject from a stale cache.
	const before = injectedRouteMessages(agent).length;
	await dispatchPreStep(harness.root, agent, [], { step: 2 });
	assert.equal(injectedRouteMessages(agent).length, before, "a disposed plugin must not inject");
});

test("REGRESSION: a RESUMED session must not label step 1 with the PREVIOUS run's route", async () => {
	// `Session.fromRestore` seeds the log with the previous run, and
	// `requestContext()` folds that whole log — so before this run requests
	// anything, the fold already returns the OLD route. Trusting it labels the
	// new run with a route it is not using, which is exactly the class of bug
	// the live-route fix was meant to end (only older than the dispatch seed).
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-resumed", {
		seededFrom: { provider: "old-provider", model: "old-model" }
	});

	// Step 1: nothing requested in THIS run yet.
	await dispatchPreStep(harness.root, agent, [], { step: 1 });
	assert.equal(
		injectedRouteMessages(agent).length,
		0,
		"the previous run's folded route must not be reported as this run's"
	);

	// This run then commits its own route: now the fold is evidence again.
	await dispatchRequest(harness.root, agent, { provider: "new-provider", model: "new-model" }, { step: 1 });
	await dispatchPreStep(harness.root, agent, [], { step: 2 });
	const injected = injectedRouteMessages(agent);
	assert.equal(injected.length, 1);
	assert.ok(injected[0].content[0].text.includes("new-provider/new-model"));
	assert.ok(
		!injected[0].content[0].text.includes("old-provider"),
		"the previous run's route must never surface"
	);
	await disposeHarness(harness);
});

test("a partially known route is NOT rendered (no `model=unknown` placeholder)", async () => {
	// A half-filled fold used to pass the "either half is non-empty" test and
	// render `model=unknown`, which the model could then repeat as fact. A route
	// is either fully known or not reported.
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-partial");
	// A fold with a provider but no model.
	agent.commitRoute({ provider: "workbuddy", model: "" });

	await dispatchPreStep(harness.root, agent, [], { step: 1 });
	assert.equal(
		injectedRouteMessages(agent).length,
		0,
		"a partial route must stay silent, not render a placeholder"
	);
	await disposeHarness(harness);
});

test("REGRESSION (host 0.2.1-rc.2): a restored session whose PREVIOUS run requested never re-announces its route", async () => {
	// The host widened what `isSeeded` MEANS. In 0.2.1-rc.2 the exclusive
	// in-memory constructor's seed path marks the header `isSeeded: true`, and
	// `Session.fromRestore` now REQUIRES an explicit seed whenever `isSeeded` is
	// set ("seeded session requires an explicit constructor seed"). So the flag
	// no longer implies "the previous run requested": it means "this session
	// inherits a prefix".
	//
	// The plugin's stale-fold guard keys on exactly that flag. Under the widened
	// meaning it must still be correct: step 1 of the new run folds the OLD run's
	// `request/context`, so it must stay SILENT; after this run settles a request
	// the fold belongs to this run again and the NEW route is reported — never
	// the old one.
	//
	// Mutation check: dropping the `isStaleFold` guard reports `old-provider` on
	// step 1 and fails the first assertion; making the guard unconditional
	// (never trusting a restored session) fails the second.
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-exclusive-restore", {
		seededFrom: { provider: "old-provider", model: "old-model" }
	});
	assert.equal(agent.session.header.isSeeded, true, "fixture must model a seeded header");

	await dispatchPreStep(harness.root, agent, [], { step: 1 });
	assert.equal(
		injectedRouteMessages(agent).length,
		0,
		"a restore whose previous run requested must not be re-announced"
	);

	await dispatchRequest(harness.root, agent, { provider: "new-provider", model: "new-model" }, { step: 1 });
	await dispatchPreStep(harness.root, agent, [], { step: 2 });
	const injected = injectedRouteMessages(agent);
	assert.equal(injected.length, 1);
	assert.ok(injected[0].content[0].text.includes("new-provider/new-model"));
	assert.ok(
		!injected[0].content[0].text.includes("old-provider"),
		"the previous run's route must never surface"
	);
	await disposeHarness(harness);
});

// ── the delivery mechanism: same step, then persisted ──────────────────────

test("the line is delivered in the SAME step whose route became known (not one step later)", async () => {
	// The regression this guards: the injector used to prepend into
	// `inbox.next-step`, but `preStep()` claims (drains) that list BEFORE this
	// waterfall runs — so the line could only be claimed by the NEXT preStep and
	// reached the model one step late. A two-step subagent never saw it at all.
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-same-step");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	const decision = await dispatchPreStep(harness.root, agent, undefined, { step: 2 });

	const delivered = decision.messages.filter(isRouteContext);
	assert.equal(delivered.length, 1, "the line must be part of THIS step's messages");
	assert.ok(
		delivered[0].content[0].text.includes("workbuddy/deepseek-v4.1-flash"),
		"and it must carry the live route"
	);
	// The old mechanism would have left it pending in the inbox instead.
	assert.equal(agent.inbox.nextStep.length, 0, "nothing may be left pending in the inbox");
	await disposeHarness(harness);
});

test("the delivered line is persisted, so later steps still see it without re-injecting", async () => {
	// `step()` appends every `decision.messages` entry to the session as a
	// `user/message`. That is why one delivery is enough: step 3 reads history.
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-persist");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent, undefined, { step: 2 });
	// Steps 3 and 4 carry no new claimed messages (a tool-using step looks
	// exactly like this), so nothing is injected again.
	await dispatchPreStep(harness.root, agent, [], { step: 3 });
	await dispatchPreStep(harness.root, agent, [], { step: 4 });

	assert.equal(injectedRouteMessages(agent).length, 1, "exactly ONE delivery across the whole run");
	assert.equal(
		visibleRouteMessages(agent).length,
		1,
		"and exactly one copy in history — no pile-up, no disappearance"
	);
	await disposeHarness(harness);
});

test("a route change mid-run delivers the NEW route and keeps only one visible line per route", async () => {
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-change");

	await dispatchRequest(harness.root, agent, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
	await dispatchPreStep(harness.root, agent, undefined, { step: 2 });

	// Failover swaps the settled route.
	await dispatchRequest(harness.root, agent, { provider: "other-provider", model: "gpt-5.6" });
	const second = await dispatchPreStep(harness.root, agent, [], { step: 3 });

	const delivered = second.messages.filter(isRouteContext);
	assert.equal(delivered.length, 1, "the new route is delivered exactly once");
	assert.ok(delivered[0].content[0].text.includes("other-provider/gpt-5.6"), "and it is the NEW route");

	// History keeps the earlier line (it was already sent; a message cannot be
	// unsent), but the new route is never duplicated.
	const visible = visibleRouteMessages(agent).map((m) => m.content[0].text);
	assert.equal(visible.filter((t) => t.includes("other-provider/gpt-5.6")).length, 1);
	assert.equal(injectedRouteMessages(agent).length, 2, "one delivery per route, never per step");
	await disposeHarness(harness);
});
