// Regression guard for the `@deepseek-ai/*` peer range contract.
//
// This plugin targets the DSH 0.1.7 line and later. The 0.1.7 line removed the
// `settingsScope` client service and the `settings.plugin.item` slot, deleted
// `SettingsProvider` / `installSettingsSection` from `@deepseek-ai/dsh-settings`,
// deleted the `agent/session-start` event, and made the plugin's own `Config`
// the settings surface. 0.1.6 and older hosts are no longer supported, so every
// peer range pins the `>=0.1.7-rc.1` floor.
//
// ── WHY THE CEILING IS `<0.3.0-0` AND NOT `<0.2.0` ──────────────────────────
//
// The ceiling was `<0.2.0` while only the 0.1.7 line existed. That range is a
// trap, because the HOST does not evaluate it with default semver options.
// `@deepseek-ai/dsh-app-boot` checks every peer with:
//
//     semver.satisfies(runtimeVersion, range, { includePrerelease: true })
//
// `includePrerelease` DISABLES the prerelease-tuple rule, so `<0.2.0` admits
// `0.2.0-rc.1` (a prerelease below the bound) while the same range REJECTS the
// stable `0.2.0`. The practical result was the worst possible split: every
// 0.2.0 prerelease loaded the plugin, and the stable 0.2.0 release — the day it
// shipped — would have failed `evaluatePluginCompatibility`, made
// `loadProfileDirectory` throw for this bundle, and dropped the plugin
// (host AND client halves) into `skippedBundles` with a startup warning.
//
// `<0.3.0-0` states the intent directly: admit the whole 0.2.x line, including
// its prereleases and stable releases, and stop before 0.3.0. The `-0` suffix
// is what excludes `0.3.0-rc.1`, which plain `<0.3.0` would admit under
// `includePrerelease`.
//
// The earlier version of this file modelled semver by hand with the
// prerelease-tuple rule ALWAYS on — i.e. with the host's actual options absent.
// It therefore asserted that `0.2.0-rc.1` must be rejected, which is the exact
// opposite of what the host does, and the guard passed while the real gate was
// already admitting 0.2.0 prereleases. The model below is fixed to the host's
// options, and prefers the real `semver` package when it resolves.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const PEERS = Object.keys(pkg.peerDependencies ?? {});

/** The range every peer must declare: 0.1.7 floor, stop before 0.3.0. */
const EXPECTED_RANGE = /^>=\s*0\.1\.7-rc\.1\s*<\s*0\.3\.0-0$/;

/** The exact options `dsh-app-boot` passes to `semver.satisfies`. */
const HOST_SEMVER_OPTIONS = { includePrerelease: true };

// ── the real semver, when it happens to resolve ─────────────────────────────
//
// `semver` is what the host evaluates these ranges with, so when it is present
// it is the best available cross-check on the fallback below. It is NOT a
// declared dependency of this plugin: it reaches the tree only through npm's
// peer auto-install (root devDep `dsh-settings` -> `dsh-config-editor` ->
// peer `dsh-app-boot` -> dep `semver`). The guard therefore never REQUIRES it —
// the fallback is the authority, pinned by its own tests — and simply uses it
// for extra fidelity when the transitive install is there.
const realSemver = (() => {
	try {
		return createRequire(import.meta.url)("semver");
	} catch {
		return undefined;
	}
})();

/** Parse `1.2.3-alpha.4` into `{ parts:[1,2,3], pre:["alpha",4] }`. */
function parse(version) {
	const [core, ...rest] = String(version).trim().split("-");
	const parts = core.split(".").map(Number);
	const pre = rest.length > 0 ? rest.join("-").split(".") : [];
	return { parts, pre };
}

/** Compare two prerelease identifier lists per the semver spec. */
function comparePre(a, b) {
	if (a.length === 0 && b.length === 0) return 0;
	if (a.length === 0) return 1; // release > prerelease
	if (b.length === 0) return -1;
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
		const x = a[i];
		const y = b[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const xn = /^\d+$/.test(x);
		const yn = /^\d+$/.test(y);
		if (xn && yn) {
			if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
		} else if (xn !== yn) {
			return xn ? -1 : 1; // numeric identifiers sort before alphanumeric
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/** Total order over two versions; -1 | 0 | 1. */
function compare(a, b) {
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < 3; i += 1) {
		if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] < pb.parts[i] ? -1 : 1;
	}
	return comparePre(pa.pre, pb.pre);
}

/**
 * Fallback evaluator replicating `semver.satisfies(range, version, { includePrerelease: true })`.
 *
 * The load-bearing difference from a default-options model: with
 * `includePrerelease` there is **no prerelease-tuple rule**. A prerelease
 * version is compared against each comparator by the plain total order, so
 * only the bound's own ordering matters. That is why `<0.2.0` ADMITS
 * `0.2.0-rc.1` (`0.2.0-rc.1` sorts below `0.2.0`) while rejecting the stable
 * `0.2.0` — the inversion the previous version of this file asserted backwards.
 *
 * Handles a comparator set of `>=` / `>` / `<` / `<=` / `=` terms joined by
 * whitespace, and `||` alternation — which is exactly the grammar the peer
 * ranges in `package.json` use. Any other operator (`^`, `~`, `x`-ranges,
 * hyphen ranges) THROWS rather than answering, because a hand-rolled
 * reimplementation of caret/tilde desugaring is itself a source of wrong
 * answers: an earlier draft of this fallback silently reported `false` for
 * every `^`/`~` range. Throwing keeps the guarantee that this evaluator either
 * agrees with node-semver or is obviously unable to answer.
 */
function satisfiesFallback(range, version) {
	const groups = String(range).split("||").map((group) => group.trim()).filter(Boolean);
	return groups.some((group) => {
		const comparators = group.split(/\s+/).filter(Boolean).map((token) => {
			const m = /^(>=|<=|>|<|=)?(.*)$/.exec(token);
			const op = m[1] ?? "";
			const bound = m[2];
			if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(bound)) {
				throw new Error(`satisfiesFallback cannot evaluate comparator ${JSON.stringify(token)}; use the real semver package`);
			}
			return { op, version: bound };
		});
		return comparators.every(({ op, version: cv }) => {
			const cmp = compare(version, cv);
			switch (op) {
				case ">=": return cmp >= 0;
				case ">": return cmp > 0;
				case "<=": return cmp <= 0;
				case "<": return cmp < 0;
				case "=":
				case "": return cmp === 0;
				default: throw new Error(`satisfiesFallback does not implement the "${op}" operator`);
			}
		});
	});
}

/** Evaluate one range the way the HOST does: through the real semver when present. */
function satisfies(range, version) {
	return realSemver === undefined
		? satisfiesFallback(range, version)
		: realSemver.satisfies(version, range, HOST_SEMVER_OPTIONS);
}

// ── tests ───────────────────────────────────────────────────────────────────

// The authoritative evaluator is the cross-validated fallback above, NOT the
// `semver` package. `semver` is deliberately NOT a declared dependency of this
// plugin: it reaches the tree only as a transitive auto-install (root devDep
// `dsh-settings` -> `dsh-config-editor` -> peer `dsh-app-boot` -> dep `semver`).
// Gating CI on an undeclared transitive would break the build the day npm's peer
// resolution changes, and this repository's convention is that tests are
// self-contained. So `semver` is used as an opportunistic FIDELITY cross-check:
// when present it validates the fallback against the host's own library, and
// when absent the assertions still run on the fallback — which is only trusted
// because `test/fallbackAgreement` below pins its semantics to the host's.

test("the fallback implements the HOST's includePrerelease semantics, not bare semver", () => {
	// This is the exact bug class the previous version of this file embodied: it
	// modelled the prerelease-tuple rule as always on and therefore asserted the
	// OPPOSITE of what the host does. Pin both inverted rows directly on the
	// fallback, so the guard holds even with no `semver` package in the tree.
	const oldRange = ">=0.1.7-rc.1 <0.2.0";
	assert.equal(
		satisfiesFallback(oldRange, "0.2.0-rc.1"),
		true,
		"with includePrerelease the old <0.2.0 ceiling ADMITS 0.2.0-rc.1 (a prerelease sorts below the bound)"
	);
	assert.equal(
		satisfiesFallback(oldRange, "0.2.0"),
		false,
		"and it REJECTS stable 0.2.0 — the P0 inversion the bare-options model got backwards"
	);
	// The ceiling actually adopted must behave the other way round.
	const adopted = ">=0.1.7-rc.1 <0.3.0-0";
	assert.equal(satisfiesFallback(adopted, "0.2.0"), true, "the adopted ceiling admits stable 0.2.0");
	assert.equal(satisfiesFallback(adopted, "0.3.0-rc.1"), false, "the -0 suffix still refuses the next line's prerelease");
});

test("the fallback agrees with the real semver when that package is available", () => {
	// Fidelity check, not the authority: `semver.satisfies(v, r,
	// { includePrerelease: true })` is literally what `dsh-app-boot` runs, so an
	// agreement here means the fallback speaks the host's dialect. Skipped with a
	// printed note when the transitive install is absent, so a missing optional
	// cross-check is visible rather than silently assumed.
	if (realSemver === undefined) {
		console.log("# note: semver is not installed; fallback semantics are pinned by the test above");
		return;
	}
	const ranges = [
		">=0.1.7-rc.1 <0.2.0",
		">=0.1.7-rc.1 <0.3.0",
		">=0.1.7-rc.1 <0.3.0-0",
		"0.1.7-rc.1",
		">0.1.7",
		"<=0.2.0",
		">=0.1.7-rc.1",
		">=0.1.7-rc.1 <0.2.0 || >=0.3.0 <0.4.0"
	];
	const versions = [
		"0.1.6", "0.1.7-alpha.1", "0.1.7-rc.1", "0.1.7-rc.2", "0.1.7", "0.1.8-rc.1",
		"0.1.8", "0.2.0-rc.1", "0.2.0-rc.2", "0.2.0", "0.2.1", "0.2.5-rc.1",
		"0.3.0-rc.1", "0.3.0", "0.3.1", "0.4.0", "1.0.0"
	];
	for (const range of ranges) {
		for (const version of versions) {
			assert.equal(
				satisfiesFallback(range, version),
				realSemver.satisfies(version, range, HOST_SEMVER_OPTIONS),
				`fallback disagreed with semver for range ${range} at version ${version}`
			);
		}
	}
});

test("the fallback refuses grammar it does not implement instead of answering", () => {
	// A wrong boolean is worse than an exception: the previous hand-modelled
	// evaluator answered confidently and was wrong about the very case that
	// mattered. Caret/tilde/x-ranges must therefore throw.
	for (const range of ["^0.1.7-rc.1", "~1.2.3", "1.x"]) {
		assert.throws(
			() => satisfiesFallback(range, "1.2.3"),
			/satisfiesFallback/,
			`${range} is outside the fallback's grammar and must throw`
		);
	}
});

test("every declared @deepseek-ai peer pins the 0.1.7-rc.1 floor and the 0.3.0 ceiling", () => {
	assert.ok(PEERS.length > 0, "expected at least one declared peer");
	for (const peer of PEERS) {
		const range = pkg.peerDependencies[peer];
		assert.match(
			range,
			EXPECTED_RANGE,
			`${peer} must declare >=0.1.7-rc.1 <0.3.0-0 (0.1.7 floor, admit the whole 0.2.x line)`
		);
	}
});

test("the range admits the 0.1.7 floor and later releases on that line", () => {
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	for (const version of ["0.1.7-rc.1", "0.1.7-rc.2", "0.1.7", "0.1.8", "0.1.9"]) {
		assert.equal(satisfies(range, version), true, `expected ${version} to satisfy the peer range`);
	}
});

test("REGRESSION: the whole 0.2.x line is admitted, stable release included", () => {
	// This is the P0 the `<0.2.0` ceiling caused. Under the host's
	// `includePrerelease: true` options the old range admitted 0.2.0
	// PRERELEASES but rejected the stable `0.2.0`, so shipping 0.2.0 would have
	// dropped this bundle into `skippedBundles`. Every 0.2.x spelling that can
	// become the running host version must be admitted.
	//
	// `0.2.1-rc.1` is listed explicitly because it IS a shippable runtime: DSH
	// Desktop 0.2.1-rc.1 ran this plugin in the field. The older list jumped from
	// `0.2.0-rc.2` straight to the stable `0.2.1`, so the exact spelling of a
	// real, running host was never asserted — a regression that rejected only
	// `0.2.1-rc.1` would have left this guard green.
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	for (const version of [
		"0.2.0-rc.1", "0.2.0-rc.2", "0.2.0",
		"0.2.1-rc.1", "0.2.1", "0.2.5-rc.1"
	]) {
		assert.equal(
			satisfies(range, version),
			true,
			`expected ${version} to satisfy the peer range (a stable 0.2.0 host must load this plugin)`
		);
	}
});

test("the range excludes the next major line, prereleases included", () => {
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	// `0.3.0-rc.1` is why the ceiling is `<0.3.0-0`: plain `<0.3.0` would admit
	// it under `includePrerelease`, silently widening support to an unreviewed line.
	for (const version of ["0.3.0-rc.1", "0.3.0", "0.3.1", "1.0.0"]) {
		assert.equal(satisfies(range, version), false, `expected ${version} to be excluded`);
	}
});

test("the HOST's own evaluator accepts this manifest, when its source is readable", async (t) => {
	// Run the HOST's real `evaluatePluginCompatibility` rather than re-modelling
	// its rule. Two things must be handled honestly, because an earlier version
	// of this test got BOTH wrong and passed while asserting nothing:
	//
	//   1. READING THE SOURCE. The host lives inside `app.asar`, which plain Node
	//      ESM cannot import (`ERR_MODULE_NOT_FOUND` — an asar is one archive file,
	//      not a directory). Worse, the module's own bare imports (`semver`, …)
	//      would not resolve even from an extracted copy. So rather than import
	//      it, READ THE TEXT of the evaluator and exercise it with a tiny
	//      `vm` sandbox whose imports we satisfy ourselves.
	//   2. REPORTING THE SKIP. If the host cannot be found, the test must SKIP
	//      LOUDLY (`t.skip`), never `return` — a silent return is counted as a
	//      pass and inflates the suite's apparent coverage.
	//
	// The host's own gate is what rejected the earlier review's false alarm:
	// `semver.satisfies(v, range)` WITHOUT `{ includePrerelease: true }` says
	// `0.2.1-rc.1` is unsatisfied, which reads as a broken peer range. The host
	// passes that option, so the range was fine.
	const homes = [
		process.env.DSH_APP_BOOT,
		"/Applications/DeepSeek Harness.app/Contents/Resources/app.asar",
		"/Applications/DSH Desktop.app/Contents/Resources/app.asar",
		"/Applications/DSH NEXT.app/Contents/Resources/app.asar"
	].filter((value) => typeof value === "string" && value !== "");

	const evaluator = findHostEvaluator(homes);
	if (evaluator === void 0) {
		// Loud, not silent: the skip is visible in the test name output.
		t.skip("no DSH installation found (set DSH_APP_BOOT to an app.asar to enable this check)");
		return;
	}

	// `unmetRequirements` is the host's judgement. `engines.dsh` wins when
	// present; otherwise every dsh peer must satisfy the runtime version.
	const unmetRequirements = evaluator;
	for (const runtime of ["0.1.7-rc.1", "0.2.0-rc.2", "0.2.1-rc.1", "0.2.1"]) {
		const unmet = unmetRequirements(pkg, runtime);
		assert.deepEqual(
			unmet,
			{},
			`the host must accept this manifest on ${runtime}, got ${JSON.stringify(unmet)}`
		);
	}

	// And it must still REJECT the shape this guard exists to prevent: a range
	// that drops exactly one 0.2.x spelling.
	const narrow = {
		name: pkg.name,
		version: pkg.version,
		peerDependencies: { "@deepseek-ai/dsh-settings": ">=0.1.7-rc.1 <0.2.0 || >=0.2.0 <0.2.1-0 || >=0.2.1 <0.3.0-0" }
	};
	assert.notDeepEqual(
		unmetRequirements(narrow, "0.2.1-rc.1"),
		{},
		"a range that rejects 0.2.1-rc.1 must be reported as unmet"
	);
});

/**
 * Locate and extract the host's `unmetRequirements` implementation.
 *
 * Reads `dsh-app-boot` out of the shim's extracted tree when present, else out of
 * an app.asar via `asar`. Returns a `(manifest, runtime) => unmet` function
 * evaluated in a `vm` sandbox, or `undefined` when the host is unavailable.
 *
 * @param {readonly string[]} homes - candidate app.asar paths, or a plugin dir.
 * @returns {((manifest: object, runtime: string) => object)|undefined} the evaluator.
 */
function findHostEvaluator(homes) {
	const sources = [];
	for (const home of homes) {
		try {
			// An already-extracted tree (the review workflow uses these).
			const direct = join(home, "dsh", "node_modules", "@deepseek-ai", "dsh-app-boot", "lib", "index.js");
			if (existsSync(direct)) sources.push(readFileSync(direct, "utf8"));
		} catch {
			// Different layout; keep looking.
		}
		try {
			if (home.endsWith(".asar") && existsSync(home)) {
				const out = execFileSync(process.execPath, [
					createRequire(import.meta.url).resolve("asar"),
					"extract-file", home, "dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js"
				], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
				if (out.trim() !== "") sources.push(out);
			}
		} catch {
			// No `asar` CLI, or the file is absent.
		}
	}
	for (const source of sources) {
		const fn = extractUnmetRequirements(source);
		if (fn !== void 0) return fn;
	}
	return undefined;
}

/**
 * Pull `unmetRequirements` out of the host bundle and wire it to the real semver.
 *
 * The host bundles that function together with its helpers; rather than
 * re-implement the rule, take the function's own source text and run it in a
 * sandbox that supplies exactly the names it closes over.
 *
 * @param {string} source - `dsh-app-boot/lib/index.js` text.
 * @returns {((manifest: object, runtime: string) => object)|undefined} evaluator.
 */
function extractUnmetRequirements(source) {
	const start = source.indexOf("function unmetRequirements(");
	if (start < 0) return undefined;
	// Brace-match to the end of the function body.
	let depth = 0;
	let index = source.indexOf("{", start);
	const from = index;
	for (; index < source.length; index += 1) {
		if (source[index] === "{") depth += 1;
		else if (source[index] === "}") {
			depth -= 1;
			if (depth === 0) break;
		}
	}
	const body = source.slice(start, index + 1);
	const helpers = ["objectOf$1", "satisfies"].map((name) => {
		const at = source.indexOf(`function ${name}(`);
		if (at < 0) return "";
		let d = 0;
		let i = source.indexOf("{", at);
		for (; i < source.length; i += 1) {
			if (source[i] === "{") d += 1;
			else if (source[i] === "}") {
				d -= 1;
				if (d === 0) break;
			}
		}
		return source.slice(at, i + 1);
	});
	if (helpers.some((text) => text === "")) return undefined;
	const sandbox = vm.createContext({ semver: createRequire(import.meta.url)("semver") });
	vm.runInContext(`${helpers.join("\n")}\n${body}\n`, sandbox);
	const candidate = sandbox.unmetRequirements;
	if (typeof candidate !== "function") return undefined;
	return (manifest, runtime) => JSON.parse(JSON.stringify(candidate(manifest, runtime)));
}

test("pre-floor 0.1.7 prereleases are excluded (alpha < rc.1)", () => {
	// The pin is `>=0.1.7-rc.1`, so earlier prereleases of the SAME tuple are
	// below the floor and correctly rejected — support starts at rc.1 exactly.
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	for (const version of ["0.1.7-alpha.1", "0.1.7-alpha.2", "0.1.7-beta.1"]) {
		assert.equal(satisfies(range, version), false, `expected ${version} to be below the floor`);
	}
});

test("the range excludes pre-0.1.7 hosts (removed APIs)", () => {
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	for (const version of ["0.1.5-rc.1", "0.1.5-rc.2", "0.1.6-alpha.1", "0.1.6", "0.1.2-alpha.1"]) {
		assert.equal(satisfies(range, version), false, `expected ${version} (pre-0.1.7) to be excluded`);
	}
});

test("HOST SEMANTICS: includePrerelease is what a bare-options model gets wrong", () => {
	// The previous test file modelled the prerelease-tuple rule as always on and
	// therefore asserted `0.2.0-rc.1` must be REJECTED by `<0.2.0`. With the
	// host's actual options it is ADMITTED. Pin that difference through
	// `satisfies()` — the same evaluator the range assertions above use, whether
	// it resolves to the real `semver` or the fallback (`satisfiesFallback` is
	// pinned independently by the earlier test, so this holds either way).
	const oldRange = ">=0.1.7-rc.1 <0.2.0";
	assert.equal(
		satisfies(oldRange, "0.2.0-rc.1"),
		true,
		"under includePrerelease the old <0.2.0 ceiling ADMITTED 0.2.0-rc.1"
	);
	assert.equal(
		satisfies(oldRange, "0.2.0"),
		false,
		"under includePrerelease the old <0.2.0 ceiling REJECTED stable 0.2.0 — the P0"
	);
});
