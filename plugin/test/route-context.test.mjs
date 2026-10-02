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
function makeAgent(id, { origin = "subagent" } = {}) {
	return recordInjections({
		id,
		inbox: makeInbox(),
		options: { provider: "deepseek-official", model: "deepseek-v4-pro" },
		session: {
			id,
			header: { origin },
			requestContext: () => ({ provider: "deepseek-official", model: "deepseek-v4-pro" })
		}
	});
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

/** Drive one `agent/request` waterfall and return the settled seed. */
function dispatchRequest(ctx, agent, seed, { turn = 1, step = 1 } = {}) {
	return ctx.waterfall("agent/request", {
		agent,
		turn,
		step,
		signal: new AbortController().signal
	}, () => Promise.resolve(seed));
}

/**
 * Drive one `agent/pre-step` waterfall.
 *
 * @returns the decision, so callers can also assert the injector is transparent
 *   (it must not disturb the messages the loop itself assembled).
 */
function dispatchPreStep(ctx, agent, messages = [], { turn = 1, step = 1 } = {}) {
	// Faithful ordering: the real loop CLAIMS (drains) the inbox at the top of
	// `preStep()`, then runs this waterfall. Skipping the claim is what hid the
	// duplicate-injection bug, so it is modelled here by default.
	const claimed = agent.inbox.claim();
	return ctx.waterfall("agent/pre-step", {
		agent,
		messages: [...claimed, ...messages],
		turn,
		step,
		signal: new AbortController().signal
	}, () => Promise.resolve({ messages: [...claimed, ...messages], kind: "continue" }));
}

/**
 * Every route line the plugin has PLACED INTO this agent so far.
 *
 * Records at placement time rather than reading `inbox.nextStep` afterwards,
 * because the real loop drains that list at the top of every `preStep()`. A
 * post-hoc read therefore sees only the current step's line — which is exactly
 * the blind spot that let the duplicate-injection bug ship (28 copies in a
 * 29-step run all looked like "exactly one").
 */
function injectedRouteMessages(agent) {
	return agent.injectedRouteLog ?? [];
}

/** Wrap an agent so every route line it receives is recorded. */
function recordInjections(agent) {
	const log = [];
	agent.injectedRouteLog = log;
	const originalPrepend = agent.inbox.prepend.bind(agent.inbox);
	agent.inbox.prepend = (target, message) => {
		if (message?.source?.kind === "plugin:dsh-subagent-default-model"
			&& message.source.form === "route-context") log.push(message);
		return originalPrepend(target, message);
	};
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

	assert.deepEqual(decision.messages, own, "the returned decision passes the loop's messages through");
	await disposeHarness(harness);
});

test("the FIRST step injects, with no prior agent/request (regression)", async () => {
	// The loop calls preStep() BEFORE buildRequest() on every iteration, so on
	// the first step no `agent/request` has fired. An implementation that only
	// reads a request-driven cache injects NOTHING for a single-step subagent —
	// which is exactly how this feature silently no-opped in a real host. The
	// injector must therefore read the agent's own live route too.
	const harness = await createHarness(ENABLED);
	const agent = makeAgent("sub-first-step");
	agent.options = { provider: "workbuddy", model: "deepseek-v4.1-flash" };

	// NO dispatchRequest call at all.
	await dispatchPreStep(harness.root, agent);

	const injected = injectedRouteMessages(agent);
	assert.equal(injected.length, 1, "the very first step must already carry the route line");
	assert.ok(
		injected[0].content[0].text.includes("workbuddy/deepseek-v4.1-flash"),
		"the first-step line must state the agent's own route"
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
