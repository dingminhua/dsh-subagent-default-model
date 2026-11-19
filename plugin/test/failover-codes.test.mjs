// Guards that the failover code set stays aligned with what the HOST actually
// raises.
//
// Why this file exists. `FAILOVER_TRIGGER_CODES` was written in 2026-08 against
// the failure codes the host raised THEN. The host kept adding codes, and
// nothing compared the two lists. By 2026-11 two codes that are the textbook
// reason this feature exists were missing — `STREAM_CLOSED` (a stream that dies
// mid-response) and `ACCOUNT_QUOTA` (the account's balance is exhausted) — and
// no test noticed, because the failover suite only ever exercised codes that
// were already in the list. A list that is only tested against itself is not a
// guard.
//
// Two layers, because one is not enough:
//
//   1. VOCABULARY (static). Read the host's own failure-code table out of the
//      installed bundle and compare it with the plugin's list. This catches a
//      host release that invents a code, even one no adapter raises yet.
//   2. BEHAVIOUR (dynamic). Drive the plugin's real `agent/request-error`
//      listener for every code and assert which ones switch. The static list
//      cannot tell you what the plugin DOES with a code; only running it can.
//
// Both skip LOUDLY when no host is installed — a silent skip would be the same
// "passes while asserting nothing" failure the asar reader docs warn about.

import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import * as plugin from "../lib/index.js";
import { readHostFile } from "../test-helpers/host-asar.mjs";

// ── the plugin's declared sets (read from the module, never copied) ─────────

const ELIGIBLE_CODES = new Set(plugin.FAILOVER_ELIGIBLE_CODES);

/**
 * Codes the plugin deliberately does NOT switch on, with the reason.
 *
 * Kept here rather than inferred, so "this code is absent on purpose" is a
 * decision someone wrote down instead of an accident nobody noticed. A code in
 * the host vocabulary that is in neither this map nor the plugin's set fails
 * the drift test below — that is the whole point.
 */
const DELIBERATELY_ABSENT = new Map([
	// ── the request or the content is wrong; another provider fails the same way
	["CONTENT_REFUSED", "the provider's safety review rejected the content; another provider refuses it too"],
	["CONTEXT_WINDOW_EXCEEDED", "the request itself is too long; switching cannot shrink it"],
	["IMAGE_OFFLOAD_REQUIRED", "the request needs image offload; a different provider has the same limit"],
	["INVALID_REQUEST", "the request is malformed; retrying it elsewhere fails identically"],
	["UNSUPPORTED_CONTENT", "the provider cannot represent this content; switching masks the capability gap"],
	["UNSUPPORTED_OPTION", "an option is unsupported; the configuration needs fixing"],
	["UNSUPPORTED_REASONING_EFFORT", "the effort is unsupported; the configuration needs fixing"],
	["MALFORMED_RESPONSE", "could be a broken provider OR a permanent adapter bug; the plugin cannot tell, and burning the pool on the latter is worse"],
	["INVALID_RESPONSE", "the provider answered, but in a shape the adapter rejects — same ambiguity as MALFORMED_RESPONSE"],
	["FILES_API", "a provider file-API failure; unrelated to the failed model request"],
	["REQUEST_EXTENSION", "a plugin-added request field was rejected; the configuration needs fixing"],
	["REQUEST_HEADERS", "custom request headers were rejected; the configuration needs fixing"],

	// ── the route or the model is misconfigured; switching would MASK the typo
	["UNKNOWN_MODEL", "the configured model id does not exist; switching would move to a DIFFERENT valid id, masking the typo"],
	["MODEL_UNSUPPORTED", "the route cannot serve this model; same masking problem as UNKNOWN_MODEL"],
	["INVALID_MODEL_CONTEXT", "the model's context limit is invalid in config; not a routing problem"],
	["INVALID_MODEL_INFO", "the model metadata is invalid; not a routing problem"],
	["INVALID_MODEL_MAX_TOKENS", "the model's max-token setting is invalid; not a routing problem"],
	["INVALID_MODEL_REASONING", "the model's reasoning setting is invalid; not a routing problem"],
	["MODEL_SWITCH_COMPACTION_FAILED", "compaction for a model switch failed; that switch is the caller's, not this one"],

	// ── credentials and sign-in; a reroute hides the real fix
	// (`AUTH` and `INVALID_CREDENTIAL` are NOT here: they switch, via
	// `AUTH_FAILURE_CODES` in lib/index.js, and the disjointness test below keeps
	// this file honest about that.)
	["ACCOUNT_SIGN_IN_REQUIRED", "no credential at all — the user must sign in; rerouting hides it"],
	["ACCOUNT_TOKEN_INVALID", "the stored account token is unusable; the fix is to sign in again"],
	["MISSING_CREDENTIAL", "no credential configured for this provider; switching hides an unconfigured provider"],
	["NO_CREDENTIAL_STORE", "no credential store is mounted; a routing change cannot mount one"],
	["CLIENT_UPGRADE_REQUIRED", "the client is too old for this provider; switching hides a version problem the user must fix"],

	// ── wiring, discovery, and installation: nothing a model switch can fix
	["NO_ADAPTER", "no adapter is registered; a routing change cannot install one"],
	["INVALID_ADAPTER", "an adapter registered incorrectly; a routing change cannot fix it"],
	["DUPLICATE_ADAPTER", "two adapters share a name; a registry problem, not a request failure"],
	["INVALID_CATALOG", "the provider's model catalog is malformed; not a request failure"],
	["NO_DISCOVERY", "the provider cannot list models; unrelated to a failed request"],
	["DISCOVERY_FAILED", "model discovery failed; unrelated to a failed request"],
	["DISCOVERY_UNSUPPORTED", "model discovery is unsupported; unrelated to a failed request"],
	["INVALID_DISCOVERY", "model discovery is misconfigured; unrelated to a failed request"],
	["INVALID_DIRECTORY", "the model directory is malformed; not a request failure"],
	["DUPLICATE_DIRECTORY", "two model directories collide; not a request failure"],
	["DUPLICATE_DISCOVERY", "two discovery providers collide; not a request failure"],
	["INVALID_CONFIG", "the provider's configuration is invalid; switching to it does not help"],
	["UNSTORABLE_PROVIDER_ID", "the provider id cannot be persisted; a configuration problem"],
	["INVALID_PREPARED_CALL", "the prepared call is malformed; a plugin bug, not a provider failure"],
	["INVALID_REPLAY_STATE", "the replay state is unusable; a persistence problem"],
	["REGISTRATION_DISPOSED", "the provider was unregistered mid-flight; retrying it elsewhere is not meaningful"],

	// ── cancellation and unclassified
	["ABORTED", "the caller cancelled; a switch would fight the cancellation"],
	["PI_AI_ERROR", "an opaque pi-ai failure with no classification; switching on an unknown risks loops"],
	["UNKNOWN", "unclassified; switching on it would turn any bug into a pool burn"]
]);

// ── layer 1: the host's vocabulary ─────────────────────────────────────────

/**
 * Parse the host's `LLM_FAILURE_CODES` table out of its built source.
 *
 * The generated bundle writes it as a plain object literal, so a brace-balanced
 * slice plus `Object.keys` is exact — no regex guesswork about which code is
 * "thrown", which matters because roughly half the adapters assign codes
 * DYNAMICALLY (`HTTP_${status}`, the account adapter's QUOTA rewrite). A
 * source-grep for `new LlmError("...", "CODE")` would miss every one of those
 * and report a clean, wrong answer.
 *
 * @param {string} source - `dsh-llm/lib/index.js` text.
 * @returns {string[]|undefined} the codes, or `undefined` when not found.
 */
function extractFailureCodes(source) {
	const marker = source.indexOf("LLM_FAILURE_CODES = {");
	if (marker < 0) return undefined;
	const open = source.indexOf("{", marker);
	let depth = 0;
	let close = -1;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === "{") depth += 1;
		else if (source[index] === "}") {
			depth -= 1;
			if (depth === 0) {
				close = index;
				break;
			}
		}
	}
	if (close < 0) return undefined;
	const body = source.slice(open + 1, close);
	const codes = [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gmu)].map((match) => match[1]);
	return codes.length > 0 ? codes : undefined;
}

const hostCodes = (() => {
	const source = readHostFile(["dsh-llm", "lib", "index.js"]);
	return source === undefined ? undefined : extractFailureCodes(source);
})();

test("the host's failure-code vocabulary is readable", (t) => {
	if (hostCodes === undefined) {
		t.skip("no DSH installation found (set DSH_APP_BOOT to an app.asar to enable this check)");
		return;
	}
	// A parse that silently returns two entries would make every assertion below
	// vacuous, so pin the shape too.
	assert.ok(hostCodes.length > 40, `expected the full host vocabulary, parsed ${hostCodes.length}`);
	for (const required of ["RATE_LIMIT", "QUOTA", "ACCOUNT_QUOTA", "SERVER", "TIMEOUT", "TRANSPORT", "EMPTY_RESPONSE", "STREAM_CLOSED", "AUTH", "INVALID_CREDENTIAL"]) {
		assert.ok(hostCodes.includes(required), `the host vocabulary must still contain ${required}`);
	}
});

test("every host failure code is either switched on, or documented as deliberately absent", (t) => {
	if (hostCodes === undefined) {
		t.skip("no DSH installation found (set DSH_APP_BOOT to an app.asar to enable this check)");
		return;
	}
	// The drift this catches: a host release adds a code, the plugin never hears
	// about it, and that code silently never switches. `STREAM_CLOSED` and
	// `ACCOUNT_QUOTA` are exactly that mistake, found 3 months late by hand.
	const unaccounted = hostCodes.filter((code) => !ELIGIBLE_CODES.has(code) && !DELIBERATELY_ABSENT.has(code));
	assert.deepEqual(
		unaccounted,
		[],
		`host failure codes neither switched nor documented: ${unaccounted.join(", ")}. ` +
			"Add it to FAILOVER_TRIGGER_CODES if another provider could succeed, " +
			"or to DELIBERATELY_ABSENT with the reason."
	);
});

test("a code listed as deliberately absent is not also switched on", (t) => {
	if (hostCodes === undefined) {
		t.skip("no DSH installation found (set DSH_APP_BOOT to an app.asar to enable this check)");
		return;
	}
	// The two lists must stay disjoint, or the file contradicts itself and the
	// real behaviour is decided by whichever assertion runs first.
	const contradictory = [...DELIBERATELY_ABSENT.keys()].filter((code) => ELIGIBLE_CODES.has(code));
	assert.deepEqual(contradictory, [], `codes both switched and excluded: ${contradictory.join(", ")}`);
});

test("a documented code must still exist in the host vocabulary", (t) => {
	if (hostCodes === undefined) {
		t.skip("no DSH installation found (set DSH_APP_BOOT to an app.asar to enable this check)");
		return;
	}
	// A stale exclusion is a decision nobody re-read. If the host removed a code,
	// the reason attached to it is now noise that hides real entries.
	const stale = [...DELIBERATELY_ABSENT.keys()].filter((code) => !hostCodes.includes(code));
	assert.deepEqual(stale, [], `documented codes the host no longer has: ${stale.join(", ")}`);
});

// ── layer 2: what the plugin DOES with each code ──────────────────────────

const SECTION = {
	provider: "deepseek-official",
	model: "deepseek-v4-pro",
	models: ["deepseek-v4-pro", "deepseek-v4-flash"],
	strategy: "round-robin",
	failoverEnabled: true
};

async function createHarness() {
	const root = new Context();
	root.provide("subagents", {
		async start(name, request) {
			return { name, request };
		},
		async startContinuable(spec) {
			return spec;
		}
	});
	if (root.logger !== undefined) root.logger.warn = () => {};
	await root[Symbol.for("cordis.init")]?.();
	const fiber = root.registry.plugin(plugin, SECTION);
	await fiber;
	return { root, fiber };
}

function makeAgent(id) {
	const selections = [];
	return {
		id,
		selections,
		options: { provider: "deepseek-official", model: "deepseek-v4-pro" },
		session: {
			id,
			header: { origin: "subagent", model: "deepseek-v4-pro" },
			requestContext: () => ({ provider: "deepseek-official", model: "deepseek-v4-pro" })
		},
		model: {
			select(selection) {
				selections.push(selection);
			}
		}
	};
}

/**
 * Drive one `agent/request-error` for a code and report whether the plugin
 * switched. Observing `agent.model.select()` — not the waterfall's return value
 * — is what makes this an end-to-end read: on this host the switch lands
 * through `select()`, and the return value is `undefined` EITHER WAY.
 */
async function switchDecision(root, code) {
	const agent = makeAgent(`probe-${code}`);
	await root.waterfall(
		"agent/request-error",
		{
			agent,
			turn: 1,
			step: 1,
			provider: "deepseek-official",
			failure: { message: `probe ${code}`, code },
			signal: new AbortController().signal
		},
		() => Promise.resolve(undefined)
	);
	return { switched: agent.selections.length > 0, target: agent.selections[0] };
}

test("BEHAVIOUR: every code the plugin claims to switch on really switches", async () => {
	const harness = await createHarness();
	try {
		for (const code of ELIGIBLE_CODES) {
			const { switched, target } = await switchDecision(harness.root, code);
			assert.equal(switched, true, `${code} is in FAILOVER_ELIGIBLE_CODES but did not switch`);
			assert.equal(target?.model, "deepseek-v4-flash", `${code} must move to the next pool entry`);
		}
	} finally {
		await harness.fiber.dispose();
		await harness.root.fiber.dispose();
	}
});

test("BEHAVIOUR: every documented-absent code really does not switch", async () => {
	const harness = await createHarness();
	try {
		for (const [code, reason] of DELIBERATELY_ABSENT) {
			const { switched } = await switchDecision(harness.root, code);
			assert.equal(switched, false, `${code} must not switch (${reason})`);
		}
	} finally {
		await harness.fiber.dispose();
		await harness.root.fiber.dispose();
	}
});

test("REGRESSION (2.2.6): STREAM_CLOSED and ACCOUNT_QUOTA switch", async () => {
	// Named explicitly, separate from the loop above, because these two are the
	// reason this file exists. If someone trims the trigger list again, the
	// generic loop would still pass for every other code while these two went
	// quietly back to ending the subagent.
	const harness = await createHarness();
	try {
		for (const code of ["STREAM_CLOSED", "ACCOUNT_QUOTA"]) {
			const { switched, target } = await switchDecision(harness.root, code);
			assert.equal(switched, true, `${code} must switch: another provider can succeed where this one failed`);
			assert.equal(target?.model, "deepseek-v4-flash", `${code} must move to the next pool entry`);
		}
	} finally {
		await harness.fiber.dispose();
		await harness.root.fiber.dispose();
	}
});

test("REGRESSION (2.2.6): the two codes are connection-class, not auth-class", async () => {
	// `STREAM_CLOSED` and `ACCOUNT_QUOTA` are transport/quota failures, so they
	// must take the ordinary switch path — no "credentials were refused" warning.
	// Filing them under AUTH would print a misleading diagnostic on every one.
	const root = new Context();
	root.provide("subagents", {
		async start(name, request) {
			return { name, request };
		},
		async startContinuable(spec) {
			return spec;
		}
	});
	const warnings = [];
	if (root.logger !== undefined) {
		root.logger.warn = (...args) => {
			warnings.push(args.map((value) => String(value)).join(" "));
		};
	}
	await root[Symbol.for("cordis.init")]?.();
	const fiber = root.registry.plugin(plugin, SECTION);
	await fiber;
	try {
		for (const code of ["STREAM_CLOSED", "ACCOUNT_QUOTA"]) {
			warnings.length = 0;
			await switchDecision(root, code);
			assert.equal(
				warnings.some((warning) => warning.includes("credentials")),
				false,
				`${code} must not emit the credentials warning`
			);
		}
	} finally {
		await fiber.dispose();
		await root.fiber.dispose();
	}
});
