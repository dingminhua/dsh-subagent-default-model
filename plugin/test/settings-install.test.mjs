import assert from "node:assert/strict";
import test from "node:test";
import { settingsSectionInstaller } from "../lib/index.js";

// DSH 0.1.2-alpha.2 removed the standalone `installSettingsSection` /
// `settingsNamespace` exports from `@deepseek-ai/dsh-settings` in favor of
// the `ctx.settings` service seam (`settings.installSection`), while older
// hosts expose only the legacy helper. The plugin must register its section
// through whichever surface the installed generation provides. These tests
// pin the decision logic for both generations; the real module is exercised
// end-to-end by the default-model and failover harnesses against the pinned
// devDependency (0.1.2-rc.1: no legacy exports, official seam).

test("a module shipping the legacy helper delegates to it verbatim", () => {
	const calls = [];
	const legacyModule = {
		installSettingsSection(ctx, ns, schema, entry, hooks) {
			calls.push({ ctx, ns, schema, entry, hooks });
		}
	};
	const install = settingsSectionInstaller(legacyModule);
	const ctx = {};
	const schema = { schema: true };
	const entry = { entry: true };
	const hooks = { setSource() {}, onChange() {} };
	install(ctx, "subagent-default-model", schema, entry, hooks);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].ctx, ctx);
	assert.equal(calls[0].ns, "subagent-default-model");
	assert.equal(calls[0].schema, schema);
	assert.equal(calls[0].entry, entry);
	assert.equal(calls[0].hooks, hooks);
});

test("a module without the legacy helper wires the official settings service seam", () => {
	const seamCalls = [];
	const injects = [];
	const settings = {
		installSection(...args) {
			seamCalls.push(args);
		}
	};
	const ctx = {
		inject(services, callback) {
			injects.push(services);
			callback({ settings });
		}
	};
	const install = settingsSectionInstaller({ SettingsProvider: class {} });
	const schema = { schema: true };
	const entry = { entry: true };
	const hooks = { setSource() {}, onChange() {} };
	install(ctx, "subagent-default-model", schema, entry, hooks);
	assert.deepEqual(injects, [["settings"]]);
	assert.equal(seamCalls.length, 1);
	// The consumer plugin context stays the section owner across the seam.
	assert.equal(seamCalls[0][0], ctx);
	assert.equal(seamCalls[0][1], "subagent-default-model");
	assert.equal(seamCalls[0][2], schema);
	assert.equal(seamCalls[0][3], entry);
	assert.equal(seamCalls[0][4], hooks);
});

test("an absent module also falls back to the service seam", () => {
	const injects = [];
	const ctx = {
		inject(services, callback) {
			injects.push(services);
			callback({ settings: { installSection() {} } });
		}
	};
	const install = settingsSectionInstaller(undefined);
	install(ctx, "subagent-default-model", {}, {}, { setSource() {}, onChange() {} });
	assert.deepEqual(injects, [["settings"]]);
});
