// DSH 0.1.7 settings model: the plugin's own Cordis `Config` IS the settings
// section. There is no standalone `installSettingsSection` / `settingsNamespace`
// export and no `ctx.settings.installSection` seam anymore (both removed in
// 0.1.7 — see docs/dsh-0.1.5-rc2-to-0.1.7-rc1-research.md §3.2/§3.3). The host
// projects the `Config` into a form keyed by the Loader entry id and writes
// changes back to the profile patch. These tests pin:
//   1. `Config` is exported and matches the old section schema shape;
//   2. volatile marking degrades to an identity no-op on schemastery builds
//      that lack `volatile()` (so the plugin still loads, just without
//      hot-reload), and marks the fields when supported;
//   3. `apply(ctx, config)` runs without a settings source and treats a missing
//      config as an empty section (children inherit the parent route).

import assert from "node:assert/strict";
import test from "node:test";
import { Config, apply, volatileField } from "../lib/index.js";

test("the plugin exports a Config matching the old section schema", () => {
	assert.ok(Config !== undefined, "Config must be exported");
	const dict = Config.dict ?? Config.meta?.dict ?? Config;
	const keys = Object.keys(dict);
	assert.ok(keys.includes("provider"), "Config must carry provider");
	assert.ok(keys.includes("model"), "Config must carry model");
	assert.ok(keys.includes("models"), "Config must carry models");
	assert.ok(keys.includes("strategy"), "Config must carry strategy");
	assert.ok(keys.includes("failoverEnabled"), "Config must carry failoverEnabled");
});

test("volatile() absence degrades to an identity field (no load-time break)", () => {
	const plain = { description: "x" };
	assert.equal(volatileField(plain), plain, "identity no-op when volatile() is unavailable");
});

test("missing config applies without a settings source (inherit parent route)", () => {
	const ctx = {
		inject() {},
		on() { return () => {}; },
		effect(fn) { return fn(); },
		logger: { warn() {}, info() {} }
	};
	assert.doesNotThrow(() => apply(ctx, undefined), "apply must accept an absent config");
	assert.doesNotThrow(() => apply(ctx, {}), "apply must accept an empty config");
});
