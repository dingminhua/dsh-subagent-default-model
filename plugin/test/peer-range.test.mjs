// Regression guard for the `@deepseek-ai/*` peer range contract.
//
// Why this exists: semver excludes a prerelease version from a comparator set
// unless some comparator in that set carries a prerelease with the SAME
// [major, minor, patch] tuple. The original range
//
//   ^0.1.0-rc.6 || ^0.1.1-rc.2 || >=0.1.2-alpha.1 <0.2.0
//
// therefore admitted 0.1.2-rc.1 but NOT 0.1.5-rc.1 — the exact kernel version
// DSH Desktop 2.0.9 bundles. Consumers installing this plugin against that
// runtime got an ERESOLVE "overriding peer dependency" warning. The 0.1.5
// tuple needs its own prerelease-bearing comparator, which is what the
// `>=0.1.5-alpha.1 <0.2.0` clause supplies.
//
// The test parses the real published range from package.json, so it fails if
// anyone narrows, drops, or "simplifies" a clause without re-checking the
// prerelease semantics.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const PEERS = Object.keys(pkg.peerDependencies ?? {});

// ── minimal semver prerelease-aware comparison ──────────────────────────────

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

/** True when the comparator set is a prerelease range (any comparator carries a pre). */
function hasPrereleaseComparator(comparators) {
	return comparators.some((c) => parse(c.version).pre.length > 0);
}

/**
 * A prerelease version satisfies a set only if some comparator in the set
 * carries the same [major,minor,patch] tuple AND itself has a prerelease.
 * This mirrors node-semver's rule and is the crux of the original bug.
 */
function sameTupleCarrier(comparators, version) {
	const v = parse(version);
	return comparators.some((c) => {
		const cv = parse(c.version);
		return cv.pre.length > 0 && cv.parts.every((p, i) => p === v.parts[i]);
	});
}

/** Evaluate one `||`-joined range against a concrete version. */
function satisfies(range, version) {
	const v = parse(version);
	const groups = String(range).split("||").map((g) => g.trim()).filter(Boolean);
	return groups.some((group) => {
		const comparators = group.split(/\s+/).filter(Boolean).map((token) => {
			const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token);
			const op = m[1] ?? "";
			const ver = m[2];
			return { op, version: ver };
		});
		if (hasPrereleaseComparator(comparators) && v.pre.length > 0 && !sameTupleCarrier(comparators, version)) {
			return false;
		}
		return comparators.every(({ op, version: cv }) => {
			const cmp = compare(version, cv);
			const cp = parse(cv);
			switch (op) {
				case ">=": return cmp >= 0;
				case ">": return cmp > 0;
				case "<=": return cmp <= 0;
				case "<": return cmp < 0;
				case "=":
				case "": return cmp === 0;
				case "^": {
					// Caret on a 0.x line: >= version, < next minor (with prerelease floor).
					const upper = [cp.parts[0], cp.parts[1] + 1, 0].join(".");
					return cmp >= 0 && compare(version, upper) < 0;
				}
				case "~": {
					const upper = [cp.parts[0], cp.parts[1], cp.parts[2] + 1].join(".");
					return cmp >= 0 && compare(version, upper) < 0;
				}
				default: throw new Error(`unsupported operator: ${op}`);
			}
		});
	});
}

// ── tests ───────────────────────────────────────────────────────────────────

test("every declared @deepseek-ai peer uses the tuple-complete range", () => {
	assert.ok(PEERS.length > 0, "expected at least one declared peer");
	for (const peer of PEERS) {
		const range = pkg.peerDependencies[peer];
		assert.match(
			range,
			/>=\s*0\.1\.5-alpha\.1\s*<\s*0\.2\.0/,
			`${peer} must carry the 0.1.5 prerelease comparator (semver tuple rule)`
		);
	}
});

test("the range admits every kernel version this plugin supports", () => {
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	const supported = [
		"0.1.0-rc.6",   // oldest supported line
		"0.1.1-rc.2",
		"0.1.2-alpha.1",
		"0.1.2-rc.1",   // previous pinned devDependency baseline
		"0.1.5-alpha.1",
		"0.1.5-alpha.2",
		"0.1.5-rc.1",   // kernel bundled by DSH Desktop 2.0.9 — the regression
		"0.1.5-rc.2"    // current npm `next` channel
	];
	for (const version of supported) {
		assert.equal(satisfies(range, version), true, `expected ${version} to satisfy the peer range`);
	}
});

test("the range still excludes the next major line", () => {
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	for (const version of ["0.2.0", "0.2.0-rc.1", "1.0.0"]) {
		assert.equal(satisfies(range, version), false, `expected ${version} to be excluded`);
	}
});

test("the range excludes the 0.1.3/0.1.4 gap lines never published as stable", () => {
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	// 0.1.3-alpha.2 was published, but the family never targeted it; admitting it
	// is not required. Assert the documented behaviour explicitly so a future
	// widening is a conscious decision rather than an accident.
	assert.equal(satisfies(range, "0.1.3-alpha.2"), false);
});

test("the regression: 0.1.5-rc.1 is admitted (the original range rejected it)", () => {
	const original = "^0.1.0-rc.6 || ^0.1.1-rc.2 || >=0.1.2-alpha.1 <0.2.0";
	assert.equal(satisfies(original, "0.1.5-rc.1"), false, "original range must reproduce the bug");
	const current = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	assert.equal(satisfies(current, "0.1.5-rc.1"), true, "fixed range must admit the bundled kernel");
});
