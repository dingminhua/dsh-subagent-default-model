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

async function createHarness(document = {}, { continuable = true } = {}) {
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
		}
	};
	if (!continuable) delete subagents.startContinuable;
	const originalStart = subagents.start;
	const originalStartContinuable = subagents.startContinuable;
	root.provide("subagents", subagents);

	const settings = new MemorySettings(root, document);
	await settings.load().then((loaded) => settings.publish(loaded));
	await root[Symbol.for("cordis.init")]?.();
	const fiber = root.registry.plugin(defaultModelPlugin);
	await fiber;

	return { root, settings, subagents, originalStart, originalStartContinuable, calls, fiber };
}

async function disposeHarness(harness) {
	await harness.fiber.dispose();
	await harness.root.fiber.dispose();
}

const defaultSection = {
	"subagent-default-model": {
		provider: "deepseek-official",
		model: "deepseek-v4-pro"
	}
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

test("round-robins model entries and observes settings updates", async () => {
	const harness = await createHarness({
		"subagent-default-model": {
			provider: "deepseek-official",
			models: ["deepseek-v4-pro", "deepseek-v4-flash"],
			strategy: "round-robin"
		}
	});
	try {
		await harness.subagents.start("one", {});
		await harness.subagents.start("two", {});
		await harness.subagents.start("three", {});
		assert.deepEqual(
			harness.calls.map((call) => call.request.agentOptions.model),
			["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-pro"]
		);

		harness.settings.publish({
			"subagent-default-model": {
				provider: "deepseek-official",
				model: "deepseek-v4-reasoner"
			}
		});
		await harness.subagents.start("updated", {});
		assert.deepEqual(harness.calls[3].request.agentOptions, {
			provider: "deepseek-official",
			model: "deepseek-v4-reasoner"
		});
	} finally {
		await disposeHarness(harness);
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

test("disposal restores services and allows a clean remount", async () => {
	const harness = await createHarness(defaultSection);
	try {
		assert.notStrictEqual(harness.subagents.start, harness.originalStart);
		assert.notStrictEqual(harness.subagents.startContinuable, harness.originalStartContinuable);

		await harness.fiber.dispose();
		assert.strictEqual(harness.subagents.start, harness.originalStart);
		assert.strictEqual(harness.subagents.startContinuable, harness.originalStartContinuable);
		await harness.subagents.start("after-dispose", { prompt: "hello" });
		assert.equal(harness.calls[0].request.agentOptions, undefined);

		const remounted = harness.root.registry.plugin(defaultModelPlugin);
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
