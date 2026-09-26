// DSH 0.1.7 settings model: the plugin's own Cordis `Config` IS the settings
// section. There is no standalone `installSettingsSection` / `settingsNamespace`
// export and no `ctx.settings.installSection` seam anymore (both removed in
// 0.1.7 — see docs/dsh-0.1.5-rc2-to-0.1.7-rc1-research.md §3.2/§3.3). The host
// projects the `Config` into a form keyed by the Loader entry id and writes
// changes back to the profile patch. These tests pin:
//   1. `Config` is exported and matches the old section schema shape;
//   2. volatile marking is applied on EVERY schemastery build, including a
//      pre-3.18.4 one that lacks `volatile()` (it falls back to `extra()`).
//      An unmarked schema makes dsh-settings DROP the namespace, which is the
//      "Host serves no settings store for this plugin" save failure;
//   3. every field DECLARES a schema default. A field resolving to `undefined`
//      is dropped from the settings form by `projectForm()`, so the card can
//      neither write nor verify it (`notApplied:ready:writable=true`);
//   4. `apply(ctx, config)` runs without a settings source and treats a missing
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

test("volatile() absence still marks the field (falls back to extra())", () => {
	// A schemastery build older than 3.18.4 exposes `extra` but not `volatile`.
	// Returning the field UNMARKED here is what makes dsh-settings drop the
	// namespace, so the fallback must mark it rather than no-op.
	const legacy = {
		meta: {},
		extra(key, value) {
			this.meta[key] = value;
			return this;
		}
	};
	const marked = volatileField(legacy);
	assert.equal(marked, legacy, "the same field instance is returned");
	assert.equal(marked.meta.volatile, true, "the marker must be applied without volatile()");
});

test("volatile() is preferred when the build provides it", () => {
	let called = false;
	const modern = {
		meta: {},
		volatile() {
			called = true;
			this.meta.volatile = true;
			return this;
		}
	};
	const marked = volatileField(modern);
	assert.equal(called, true, "the modern method must win");
	assert.equal(marked.meta.volatile, true, "the marker must be applied");
});

test("a field offering neither method is returned unchanged (no load-time break)", () => {
	const inert = { description: "x" };
	assert.equal(volatileField(inert), inert, "identity when the build offers nothing");
});

test("every declared Config field actually carries the volatile marker", () => {
	const dict = Config.dict ?? Config.meta?.dict ?? Config;
	const keys = Object.keys(dict);
	assert.ok(keys.length > 0, "Config must declare fields");
	// The module marks its fields at declaration time. A field that lost the
	// marker would silently drop the whole namespace from the settings surface,
	// so this is the regression guard for that failure.
	for (const key of keys) {
		assert.equal(dict[key].meta?.volatile, true, `Config field "${key}" must be marked volatile`);
	}
});

test("every declared Config field carries a schema default", () => {
	// `@deepseek-ai/dsh-settings` builds the settings surface with
	// `projectForm()`, which walks the form schema and DROPS any field whose
	// resolved value is `undefined`:
	//
	//     return field === void 0 ? [] : [[key, projectForm(child, field)]];
	//
	// A bare `z.string()` with no `.default(...)` resolves to `undefined`, so
	// such a field is ABSENT from the descriptor the settings card reads and
	// writes against. The card then writes `provider: "workbuddy"`, compares the
	// read-back (which never mentions `provider`) and reports the misleading
	// `notApplied:ready:writable=true`: ready and writable, yet the field it
	// wrote is not one this form can see. Declaring a default keeps every field
	// present, which is what makes it readable, writable, and verifiable.
	const dict = Config.dict ?? Config.meta?.dict ?? Config;
	for (const key of Object.keys(dict)) {
		assert.notEqual(
			dict[key].meta?.default,
			undefined,
			`Config field "${key}" needs a .default(...) or the settings form silently drops it`
		);
	}
	// The empty string is the declared default for the three "unset" strings,
	// and the rest of the plugin already treats "" as "inherit the parent route".
	assert.equal(dict.provider.meta.default, "", "provider defaults to the empty (inherit) value");
	assert.equal(dict.model.meta.default, "", "model defaults to the empty (inherit) value");
	assert.equal(dict.reasoningEffort.meta.default, "", "reasoningEffort defaults to the empty (unset) value");
});

test("the resolved section exposes all six fields (none resolved away)", () => {
	// Direct guard on the failure above: resolve the schema the way an empty
	// stored section does, unwrap the volatile references, and require every key
	// to be PRESENT. This is exactly what `projectForm` filters on, so a field
	// that resolves to `undefined` disappears from the settings form altogether.
	const resolved = Config({});
	const present = Object.entries(resolved)
		.map(([key, value]) => [
			key,
			value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value
		])
		.filter(([, value]) => value !== undefined)
		.map(([key]) => key)
		.sort();
	assert.deepEqual(
		present,
		["failoverEnabled", "model", "models", "provider", "reasoningEffort", "strategy"],
		"a field resolving to undefined is dropped from the settings form altogether"
	);
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
