// End-to-end regression guards for the REAL host settings write gate.
//
// Every other settings test in this repository drives a STUB of the host's
// controller. That is exactly the gap that let the 2.0.4–2.0.7 save failures
// hide: the plugin's own card, its own scope, and its own idea of the write
// contract all agreed with each other while the real `@deepseek-ai/dsh-settings`
// gate disagreed. This file closes that gap by importing the ACTUAL host
// implementation and running the plugin's real `Config` through it:
//
//   - `volatileForm(schema)` — returns `undefined` when no field carries the
//     volatile marker, and `describe()` then DROPS the entry. The client's
//     forwarding scope can never bind to a namespace the directory omits, so
//     every save reports `notApplied:unavailable:writable=false`. This was the
//     2.0.4 P0 (`volatile()` missing on a stale schemastery build).
//   - `projectForm(form, value)` — drops any field whose resolved value is
//     `undefined`, which is why every `Config` field must declare a default.
//     A dropped field is invisible to the card's read-back, which is the
//     2.0.5 `notApplied:ready:writable=true` failure.
//   - `isVolatilePath(schema, path)` — refuses every edit path not under a
//     marked node with `Config field "…" is not volatile`.
//   - `SettingsForms.describe()/mutate()` — the real read and the real ONE-shot
//     atomic write the card performs on Save, including the revision fence.
//
// `@deepseek-ai/dsh-settings` is a devDependency pinned to the 0.1.7 line, and
// its `src/` is byte-identical between `dsh-v0.1.7-rc.2` and `dsh-v0.2.0-rc.1`,
// so this gate behaves the same on both hosts. If the package cannot resolve the
// file skips LOUDLY rather than passing silently.

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

import { Config } from "../lib/index.js";

const require = createRequire(import.meta.url);

/** The real host settings implementation, or undefined when unresolvable. */
const host = (() => {
	try {
		return {
			SettingsForms: require("@deepseek-ai/dsh-settings").SettingsForms,
			Context: require("@deepseek-ai/cordis").Context
		};
	} catch {
		return undefined;
	}
})();

/** The Loader entry id, which on 0.1.7+ IS the settings namespace. */
const NS = "dsh-subagent-default-model";

/**
 * Build a context faithful to what `SettingsForms` reads, backed by the REAL
 * plugin `Config` schema and a real profile-patch write that round-trips.
 *
 * The stub covers only the collaborators the Service resolves: `configEditor`
 * (entries/configuration/edit/documentPath), `profileContext`, and the loader
 * await the constructor schedules. Everything the assertions actually exercise
 * — schema projection, field visibility, volatile-path authorization, revision
 * fencing, and the merged patch — is the host's own code.
 *
 * The staging mirrors the host's own two-stage model, which is load-bearing:
 *
 *   - `stored()` holds the RAW stored values (what the profile patch
 *     contains). `ConfigEditor.edit()` hands this to `change()` and stores what
 *     `change()` returns.
 *   - `entry.fiber.config` holds the RESOLVED config, in which volatile fields
 *     are `{ get() }` references. This is what `describe()` projects for `value`.
 *
 * Collapsing the two would hand the gate `{ get() }` objects where it expects
 * plain data, and `cloneJsonShaped` rejects functions — the real host never
 * conflates them, so neither may this harness.
 *
 * @returns a harness with the forms service, its entry, and live storage.
 */
function harness() {
	const ctx = new host.Context();
	ctx.root.loader = { await: () => Promise.resolve() };

	/** Raw stored config: starts empty, i.e. nothing in the profile patch yet. */
	let raw = {};
	const entry = {
		id: NS,
		options: { id: NS, config: raw },
		fiber: { state: 2, uid: 1, config: Config(raw), ctx, runtime: { Config } }
	};

	ctx.configEditor = {
		configuration: () => [{ entry, inherited: raw, override: raw }],
		entries: () => [entry],
		documentPath: "/tmp/probe/cordis.patch.yml",
		async edit(_entry, change) {
			// The Loader recreates the entry's fiber on a write, so the resolved
			// config is re-derived from the newly stored raw values.
			raw = change(structuredClone(raw), raw);
			entry.options.config = raw;
			entry.fiber.config = Config(raw);
		}
	};
	ctx.profileContext = { dir: "/tmp/probe", home: "/tmp/probe", name: "test", installAnchor: "/tmp/probe" };

	return {
		ctx,
		entry,
		forms: new host.SettingsForms(ctx),
		/** The raw stored config, i.e. what the profile patch now contains. */
		stored: () => entry.options.config
	};
}

/** Every field the settings card owns and writes on one Save. */
const CARD_FIELDS = ["provider", "model", "models", "strategy", "failoverEnabled", "reasoningEffort"];

test("the real host settings gate resolves for end-to-end assertions", () => {
	assert.notEqual(
		host,
		undefined,
		"@deepseek-ai/dsh-settings must resolve so the REAL write gate is exercised; a stub would hide the 2.0.4–2.0.7 class of failure"
	);
});

test("REGRESSION (2.0.4): the namespace is NOT dropped from the real describe() directory", () => {
	// `describe()` filters with `volatileForm(schema) === undefined -> return []`.
	// An unmarked schema therefore removes the whole namespace, which is what
	// made the card's scope permanently unbound and every Save report
	// `notApplied:unavailable:writable=false` for a plugin the host was serving.
	const { forms } = harness();
	const descriptors = forms.describe();
	assert.equal(descriptors.length, 1, "the plugin's namespace must appear exactly once in the directory");
	assert.equal(descriptors[0].ns, NS, "the namespace IS the Loader entry id on 0.1.7+");
});

test("REGRESSION (2.0.5): every card field is PRESENT and VISIBLE in the real descriptor", () => {
	// `projectForm` drops any field whose resolved value is `undefined`. A field
	// absent here is one the card can neither read back nor verify: it writes the
	// value, compares it against a descriptor that never mentions the key, and
	// reports the misleading `notApplied:ready:writable=true`.
	const { forms } = harness();
	const descriptor = forms.describe()[0];
	for (const field of CARD_FIELDS) {
		assert.ok(
			Object.hasOwn(descriptor.value, field),
			`field "${field}" must be visible in the descriptor, or the card cannot verify its own write`
		);
	}
	// The three "unset" strings resolve to "" rather than vanishing, which is the
	// exact projection failure the defaults exist to prevent.
	assert.equal(descriptor.value.provider, "", "provider defaults to the empty (inherit) value");
	assert.equal(descriptor.value.model, "", "model defaults to the empty (inherit) value");
	assert.equal(descriptor.value.reasoningEffort, "", "reasoningEffort defaults to the empty (unset) value");
});

test("the real gate ACCEPTS the card's one atomic six-field save", async () => {
	// 2.0.5 changed the save from six independent `set()` calls (six Host
	// transactions, six revision checks) to ONE `mutate(ops)`. This asserts that
	// the real `SettingsForms.mutate` accepts precisely the op set the card
	// sends — including `reasoningEffort`, whose absence once failed every save
	// with `Config field "reasoningEffort" is not volatile`.
	const { forms, stored } = harness();
	const descriptor = forms.describe()[0];
	const ops = [
		{ op: "set", path: ["provider"], value: "glm" },
		{ op: "set", path: ["model"], value: "" },
		{ op: "set", path: ["models"], value: [{ provider: "glm", model: "deepseek-v4.1-flash", reasoningEffort: "max" }] },
		{ op: "set", path: ["strategy"], value: "round-robin" },
		{ op: "set", path: ["failoverEnabled"], value: true },
		{ op: "set", path: ["reasoningEffort"], value: "max" }
	];

	await assert.doesNotReject(
		() => forms.mutate(NS, ops, descriptor.revision),
		"the real host write gate must accept the card's atomic save"
	);

	const landed = stored();
	assert.equal(landed.provider, "glm", "provider landed in the profile patch");
	assert.equal(landed.reasoningEffort, "max", "reasoningEffort landed (the key that once failed every save)");
	assert.deepEqual(
		landed.models,
		[{ provider: "glm", model: "deepseek-v4.1-flash", reasoningEffort: "max" }],
		"the multi-model route list landed intact"
	);
});

test("a saved value ROUND-TRIPS through the real describe()", async () => {
	// The card verifies its write by reading the descriptor back. If the real
	// gate stored the value but the real projection could not show it, the card
	// would report a landed save as failed.
	const { forms } = harness();
	const first = forms.describe()[0];
	await forms.mutate(NS, [
		{ op: "set", path: ["provider"], value: "workbuddy-global" },
		{ op: "set", path: ["model"], value: "deepseek-v4.1-flash" },
		{ op: "set", path: ["reasoningEffort"], value: "high" }
	], first.revision);

	const after = forms.describe()[0];
	assert.equal(after.value.provider, "workbuddy-global", "the saved provider must be readable back");
	assert.equal(after.value.model, "deepseek-v4.1-flash", "the saved model must be readable back");
	assert.equal(after.value.reasoningEffort, "high", "the saved effort must be readable back");
});

test("an UNSET array element is removed, so a deleted route stays deleted", async () => {
	// "Delete a route, save, and it comes back" was a real reported failure. The
	// host's unset semantics are what the card relies on; this pins them so a
	// future edit cannot silently switch to writing an empty object instead.
	const { forms, stored } = harness();
	const two = [
		{ provider: "glm", model: "a" },
		{ provider: "workbuddy-global", model: "b" }
	];
	let descriptor = forms.describe()[0];
	await forms.mutate(NS, [{ op: "set", path: ["models"], value: two }], descriptor.revision);
	assert.equal(stored().models.length, 2, "both routes landed");

	descriptor = forms.describe()[0];
	await forms.mutate(NS, [{ op: "unset", path: ["models", "0"] }], descriptor.revision);
	assert.deepEqual(
		stored().models,
		[{ provider: "workbuddy-global", model: "b" }],
		"unsetting index 0 must remove that element, not blank it"
	);
});

test("a STALE revision is refused with the host's SettingsConflictError", async () => {
	// The card's save carries the revision it read. When the Loader recreates the
	// entry's fiber on a write, the revision advances and a stale write is
	// refused. 2.0.5 retries exactly once on this error, so the error TYPE is
	// load-bearing: a different error would not be retried and would surface as a
	// failed save.
	const { forms } = harness();
	const stale = forms.describe()[0].revision;
	await forms.mutate(NS, [{ op: "set", path: ["provider"], value: "first" }], stale);

	await assert.rejects(
		() => forms.mutate(NS, [{ op: "set", path: ["provider"], value: "second" }], stale),
		(error) => {
			assert.equal(error.name, "SettingsConflictError", "the fence must raise the retryable conflict error");
			assert.equal(error.code, "SETTINGS_CONFLICT", "the stable machine code the retry path keys on");
			return true;
		}
	);
});

test("the retry after a stale-revision refusal SUCCEEDS (2.0.5 hardening)", async () => {
	// `ConfigFormController.mutate()` folds the fresh revision in via `recover()`
	// before reporting the refusal, so the immediate retry carries a current
	// revision and lands. Verified against the real gate so the retry contract
	// cannot drift.
	const { forms, stored } = harness();
	const stale = forms.describe()[0].revision;
	await forms.mutate(NS, [{ op: "set", path: ["provider"], value: "first" }], stale);

	const fresh = forms.describe()[0].revision;
	await assert.doesNotReject(
		() => forms.mutate(NS, [{ op: "set", path: ["provider"], value: "second" }], fresh),
		"the retry with a fresh revision must land"
	);
	assert.equal(stored().provider, "second", "the retried write is the stored value");
});
