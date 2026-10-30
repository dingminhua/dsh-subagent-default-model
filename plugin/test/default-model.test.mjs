import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import * as defaultModelPlugin from "../lib/index.js";

// DSH 0.1.7 settings model: the plugin's `Config` IS the settings section, so
// the harness passes config straight to `apply(ctx, config)` — there is no
// `SettingsProvider` to publish and no settings service to mount. A config
// update is a fresh apply (the host re-mounts the Loader row on a config write);
// `undefined` means "no section configured", i.e. inherit the parent route.

/**
 * Mount the plugin with `config`.
 *
 * @param config - the resolved plugin Config (or undefined for "no section").
 * @param options.continuable - drop `startContinuable` to model a host that
 *   only exposes `start`.
 * @param options.activation - keep the 0.2.x `startActivation` entry point.
 * @param options.legacy - keep `start` / `startContinuable`; set false to model
 *   a 0.2.x host where `startActivation` is the ONLY delegation entry point.
 */
async function createHarness(config = undefined, { continuable = true, activation = true, legacy = true } = {}) {
	const root = new Context();
	const calls = [];
	const subagents = {
		async start(name, request) {
			calls.push({ type: "start", name, request });
			return { name, request };
		},
		async startContinuable(spec) {
			calls.push({ type: "startContinuable", spec });
			return spec;
		},
		async startActivation(spec) {
			calls.push({ type: "startActivation", spec });
			return spec;
		},
		// Provider registry: the plugin reads `inheritsParentContext` to decide
		// whether a delegation reuses the parent's conversation prefix. `fork`
		// does (it is seeded with the parent log); `spawn` does not.
		getProvider(name) {
			return PROVIDERS[name];
		}
	};
	if (!legacy) {
		// DSH 0.2.x: `start` / `startContinuable` no longer exist on the service.
		delete subagents.start;
		delete subagents.startContinuable;
	} else if (!continuable) delete subagents.startContinuable;
	if (!activation) delete subagents.startActivation;
	const originalStart = subagents.start;
	const originalStartContinuable = subagents.startContinuable;
	const originalStartActivation = subagents.startActivation;
	root.provide("subagents", subagents);

	await root[Symbol.for("cordis.init")]?.();
	const fiber = root.registry.plugin(defaultModelPlugin, config);
	await fiber;

	return { root, config, subagents, originalStart, originalStartContinuable, originalStartActivation, calls, fiber };
}

async function disposeHarness(harness) {
	await harness.fiber.dispose();
	await harness.root.fiber.dispose();
}

/** The section values as the host resolves them for the plugin's Config. */
const defaultSection = {
	provider: "deepseek-official",
	model: "deepseek-v4-pro"
};

/**
 * Delegation providers as the host advertises them.
 *
 * `inheritsParentContext` is the load-bearing field: the `fork` backend is
 * seeded with the parent's session log, so the host keeps its route equal to
 * the parent's on purpose (`dsh-base`: "Fork omits model selection so
 * provider/model stay equal to the parent and the inherited history remains
 * eligible for KV Cache reuse"). `spawn` starts from a fresh context, so a
 * route change costs it nothing.
 */
const PROVIDERS = {
	spawn: { name: "spawn", inheritsParentContext: false, capabilities: { agentOptions: true } },
	fork: { name: "fork", inheritsParentContext: true, capabilities: { agentOptions: true } }
};

test("injects a configured single model", async () => {
	const harness = await createHarness(defaultSection);
	try {
		await harness.subagents.start("worker", { prompt: "hello" });
		assert.deepEqual(harness.calls[0].request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
	} finally {
		await disposeHarness(harness);
	}
});

test("keeps the parent route when no model is configured", async () => {
	const harness = await createHarness();
	try {
		const request = { prompt: "hello" };
		await harness.subagents.start("worker", request);
		assert.strictEqual(harness.calls[0].request, request);
		assert.equal(harness.calls[0].request.agentOptions, undefined);
	} finally {
		await disposeHarness(harness);
	}
});

test("preserves explicit agent options", async () => {
	const harness = await createHarness(defaultSection);
	try {
		const request = {
			prompt: "hello",
			agentOptions: { provider: "kimi", model: "kimi-k3" }
		};
		await harness.subagents.start("worker", request);
		assert.strictEqual(harness.calls[0].request, request);
		assert.deepEqual(harness.calls[0].request.agentOptions, request.agentOptions);
	} finally {
		await disposeHarness(harness);
	}
});

test("round-robins model entries", async () => {
	const harness = await createHarness({
		provider: "deepseek-official",
		models: ["deepseek-v4-pro", "deepseek-v4-flash"],
		strategy: "round-robin"
	});
	try {
		await harness.subagents.start("one", {});
		await harness.subagents.start("two", {});
		await harness.subagents.start("three", {});
		assert.deepEqual(
			harness.calls.map((call) => call.request.agentOptions.model),
			["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-pro"]
		);
	} finally {
		await disposeHarness(harness);
	}
});

test("a config change takes effect on remount (the 0.1.7 write path)", async () => {
	// On 0.1.7 the host writes a Config change back to the profile patch and
	// re-mounts the row, so a new apply carries the new values. Model that by
	// disposing the first fiber and mounting a second with the new config.
	const first = await createHarness({
		provider: "deepseek-official",
		model: "deepseek-v4-pro"
	});
	try {
		await first.subagents.start("one", {});
		assert.equal(first.calls[0].request.agentOptions.model, "deepseek-v4-pro");
	} finally {
		await disposeHarness(first);
	}

	const second = await createHarness({
		provider: "deepseek-official",
		model: "deepseek-v4-reasoner"
	});
	try {
		await second.subagents.start("updated", {});
		assert.deepEqual(second.calls[0].request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-reasoner"
		});
	} finally {
		await disposeHarness(second);
	}
});

test("injects defaults for continuable subagents", async () => {
	const harness = await createHarness(defaultSection);
	try {
		await harness.subagents.startContinuable({ request: { prompt: "hello" } });
		assert.deepEqual(harness.calls[0].spec.request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
	} finally {
		await disposeHarness(harness);
	}
});

test("works when the host exposes only start", async () => {
	const harness = await createHarness(defaultSection, { continuable: false });
	try {
		assert.equal(harness.subagents.startContinuable, undefined);
		await harness.subagents.start("worker", { prompt: "hello" });
		assert.deepEqual(harness.calls[0].request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
	} finally {
		await disposeHarness(harness);
	}
});

test("injects defaults through the 0.2.x startActivation entry point", async () => {
	// Regression: on DSH 0.2.x the delegation tools call `subagents.startActivation`
	// and the old `start` / `startContinuable` methods are gone. Wrapping only the
	// legacy pair silently selected no route at all (children inherited the parent
	// route), which is exactly the "no model is applied" failure this plugin exists
	// to prevent.
	const harness = await createHarness(defaultSection, { legacy: false });
	try {
		assert.equal(harness.subagents.start, undefined);
		assert.equal(harness.subagents.startContinuable, undefined);
		await harness.subagents.startActivation({ request: { prompt: "hello" } });
		assert.equal(harness.calls[0].type, "startActivation");
		assert.deepEqual(harness.calls[0].spec.request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
	} finally {
		await disposeHarness(harness);
	}
});

test("startActivation keeps an explicit child route", async () => {
	const harness = await createHarness(defaultSection, { legacy: false });
	try {
		const request = {
			prompt: "hello",
			agentOptions: { provider: "kimi", model: "kimi-k3" }
		};
		const spec = { request, provider: "spawn" };
		await harness.subagents.startActivation(spec);
		// Identity is preserved: the host may compare the spec it handed in.
		assert.strictEqual(harness.calls[0].spec, spec);
		assert.strictEqual(harness.calls[0].spec.request, request);
	} finally {
		await disposeHarness(harness);
	}
});

test("startActivation inherits the parent route when nothing is configured", async () => {
	const harness = await createHarness(undefined, { legacy: false });
	try {
		const request = { prompt: "hello" };
		const spec = { request };
		await harness.subagents.startActivation(spec);
		assert.strictEqual(harness.calls[0].spec, spec);
		assert.equal(harness.calls[0].spec.request.agentOptions, undefined);
	} finally {
		await disposeHarness(harness);
	}
});

test("disposal restores services and allows a clean remount", async () => {
	const harness = await createHarness(defaultSection);
	try {
		assert.notStrictEqual(harness.subagents.start, harness.originalStart);
		assert.notStrictEqual(harness.subagents.startContinuable, harness.originalStartContinuable);
		assert.notStrictEqual(harness.subagents.startActivation, harness.originalStartActivation);

		await harness.fiber.dispose();
		assert.strictEqual(harness.subagents.start, harness.originalStart);
		assert.strictEqual(harness.subagents.startContinuable, harness.originalStartContinuable);
		assert.strictEqual(harness.subagents.startActivation, harness.originalStartActivation);
		await harness.subagents.start("after-dispose", { prompt: "hello" });
		assert.equal(harness.calls[0].request.agentOptions, undefined);

		// A remount carries the resolved Config explicitly on 0.1.7 (the host
		// re-mounts the Loader row with the current config after a write).
		const remounted = harness.root.registry.plugin(defaultModelPlugin, harness.config);
		await remounted;
		await harness.subagents.start("after-remount", { prompt: "hello" });
		assert.deepEqual(harness.calls[1].request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
		await remounted.dispose();
	} finally {
		await harness.root.fiber.dispose();
	}
});

// ── fork / same-context policy ───────────────────────────────────────────────
//
// The `fork` backend is SEEDED with the parent's conversation, and the host
// deliberately does not let it select a model so its route stays equal to the
// parent's — that is what keeps the inherited prefix eligible for KV-cache
// reuse. Injecting a pool route there re-runs the whole inherited prefix on
// another provider: one real fork child measured `inputTokens: 144185` against
// `cacheReadTokens: 186` on its first request.
//
// So `applyToForkChildren` defaults to false, and these tests pin both sides of
// the switch. Without them the policy is invisible: every other test passes
// `spawn`-shaped specs and would never notice the gate disappearing.

test("a fork child keeps the parent route by default (no agentOptions injected)", async () => {
	const harness = await createHarness(defaultSection, { legacy: false });
	try {
		const request = { prompt: "hello" };
		await harness.subagents.startActivation({ provider: "fork", request });
		assert.equal(
			harness.calls[0].spec.request.agentOptions,
			undefined,
			"a fork child must inherit the parent route so its KV cache survives"
		);
		// Identity, not just equality: the host compares spec identity, and a
		// needless clone would be a silent behaviour change.
		assert.strictEqual(harness.calls[0].spec.request, request);
	} finally {
		await disposeHarness(harness);
	}
});

test("a spawn child is still injected from the same config (the gate is fork-only)", async () => {
	// Guards the gate against over-reach: skipping fork is only correct because
	// spawn does NOT inherit the parent conversation.
	const harness = await createHarness(defaultSection, { legacy: false });
	try {
		await harness.subagents.startActivation({ provider: "spawn", request: { prompt: "hello" } });
		assert.deepEqual(harness.calls[0].spec.request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
	} finally {
		await disposeHarness(harness);
	}
});

test("applyToForkChildren: true makes a fork child follow the configured route", async () => {
	const harness = await createHarness(
		{ ...defaultSection, applyToForkChildren: true },
		{ legacy: false }
	);
	try {
		await harness.subagents.startActivation({ provider: "fork", request: { prompt: "hello" } });
		assert.deepEqual(harness.calls[0].spec.request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
	} finally {
		await disposeHarness(harness);
	}
});

test("an explicit route on a fork child wins regardless of the policy", async () => {
	// The opt-out must never override an explicit choice: the plugin's whole
	// contract is "explicit agentOptions always win".
	const harness = await createHarness(defaultSection, { legacy: false });
	try {
		const explicit = { provider: "minmax", model: "MiniMax-M3.1-Flash" };
		await harness.subagents.startActivation({
			provider: "fork",
			request: { prompt: "hello", agentOptions: explicit }
		});
		assert.deepEqual(harness.calls[0].spec.request.agentOptions, explicit);
	} finally {
		await disposeHarness(harness);
	}
});

test("an unknown provider is injected as before (capability read never disables the feature)", async () => {
	// `getProvider` returns undefined for an unregistered name. Treating that as
	// "inherits context" would silently disable injection for every custom
	// provider; the fallback must stay the long-standing inject behaviour.
	const harness = await createHarness(defaultSection, { legacy: false });
	try {
		await harness.subagents.startActivation({ provider: "some-custom-backend", request: { prompt: "hello" } });
		assert.deepEqual(harness.calls[0].spec.request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-pro"
		});
	} finally {
		await disposeHarness(harness);
	}
});
