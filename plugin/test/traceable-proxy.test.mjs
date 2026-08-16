import assert from "node:assert/strict";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";

test("uses the raw Cordis service identity for persistent state", async () => {
	const root = new Context();
	class FakeSettings extends Service {}
	new FakeSettings(root, "settings");

	try {
		const applyTime = root.get("settings");
		const executeTime = root.get("settings");
		assert.notStrictEqual(applyTime, executeTime);

		const raw = (service) => service?.[Symbol.for("cordis.original")] ?? service;
		assert.strictEqual(raw(applyTime), raw(executeTime));
	} finally {
		await root.fiber.dispose();
	}
});
