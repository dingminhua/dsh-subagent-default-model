// Regression guard for the `@deepseek-ai/*` peer range contract.
//
// This plugin targets DSH 0.1.7-rc.1 and later ONLY. The 0.1.7 line removed the
// `settingsScope` client service and the `settings.plugin.item` slot, deleted
// `SettingsProvider` / `installSettingsSection` from `@deepseek-ai/dsh-settings`,
// deleted the `agent/session-start` event, and made the plugin's own `Config`
// the settings surface (see docs/dsh-0.1.5-rc2-to-0.1.7-rc1-research.md). 0.1.6
// and older hosts are no longer supported, so every peer range is pinned to
// `>=0.1.7-rc.1 <0.2.0`. The test parses the real published range from
// package.json so it fails if anyone widens or drops the 0.1.7 floor.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const PEERS = Object.keys(pkg.peerDependencies ?? {});

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
 * This mirrors node-semver; without it `<0.2.0` would wrongly admit `0.2.0-rc.1`
 * and the 0.1.7 floor check would be meaningless.
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
			return { op: m[1] ?? "", version: m[2] };
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

test("every declared @deepseek-ai peer pins the 0.1.7-rc.1 floor", () => {
	assert.ok(PEERS.length > 0, "expected at least one declared peer");
	for (const peer of PEERS) {
		const range = pkg.peerDependencies[peer];
		assert.match(
			range,
			/>=\s*0\.1\.7-rc\.1\s*<\s*0\.2\.0/,
			`${peer} must pin >=0.1.7-rc.1 <0.2.0 (0.1.7-only support)`
		);
	}
});

test("the range admits the 0.1.7-rc.1 floor and later releases on the line", () => {
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	const supported = [
		"0.1.7-rc.1", // the aligned baseline
		"0.1.7-rc.2",
		"0.1.7",      // stable on the 0.1.7 line
		"0.1.8",      // later release on the same 0.1.x line
		"0.1.9"
	];
	for (const version of supported) {
		assert.equal(satisfies(range, version), true, `expected ${version} to satisfy the peer range`);
	}
});

test("later-line prereleases are excluded by the semver prerelease-tuple rule", () => {
	// `>=0.1.7-rc.1 <0.2.0` carries a prerelease ONLY on the 0.1.7 tuple, so a
	// prerelease of a DIFFERENT tuple (0.1.8-rc.1) has no carrier and is
	// rejected — verified against node-semver. This is expected, not a bug.
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	for (const version of ["0.1.8-rc.1", "0.1.9-alpha.1", "0.2.0-rc.1"]) {
		assert.equal(satisfies(range, version), false, `expected ${version} to be excluded (no tuple carrier)`);
	}
});

test("pre-floor 0.1.7 prereleases are excluded (alpha < rc.1)", () => {
	// The pin is `>=0.1.7-rc.1`, so earlier prereleases of the SAME tuple are
	// below the floor and correctly rejected — support starts at rc.1 exactly.
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	for (const version of ["0.1.7-alpha.1", "0.1.7-alpha.2", "0.1.7-beta.1"]) {
		assert.equal(satisfies(range, version), false, `expected ${version} to be below the floor`);
	}
});

test("the range excludes the next major line", () => {
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	for (const version of ["0.2.0", "0.2.0-rc.1", "1.0.0"]) {
		assert.equal(satisfies(range, version), false, `expected ${version} to be excluded`);
	}
});

test("the range excludes pre-0.1.7 hosts (removed APIs)", () => {
	const range = pkg.peerDependencies["@deepseek-ai/dsh-settings"];
	for (const version of ["0.1.5-rc.1", "0.1.5-rc.2", "0.1.6-alpha.1", "0.1.6", "0.1.2-alpha.1"]) {
		assert.equal(satisfies(range, version), false, `expected ${version} (pre-0.1.7) to be excluded`);
	}
});
