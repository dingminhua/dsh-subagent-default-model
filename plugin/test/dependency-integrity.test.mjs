// Guards that `npm test` cannot pass while the HOST would fail to load the plugin.
//
// Why this exists: the test runner and the host resolve modules from DIFFERENT
// bases. Tests resolve from `plugin/`; the host resolves the row name through
// the profile and follows the `link:` into `plugin/`. A dependency tree that is
// broken only for one of those bases therefore looks green locally while the
// plugin never imports in the host — observed for real: three
// `node_modules/@deepseek-ai/*` entries were symlinks into an application bundle
// that had been deleted, so the host logged `failed to import` while every test
// passed.

import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const pluginDir = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"));

/** Every entry directly under one node_modules scope. */
function entriesOf(scope) {
	if (!existsSync(scope)) return [];
	return readdirSync(scope).map((name) => ({ name, path: join(scope, name) }));
}

test("no dependency symlink points at a deleted path", () => {
	// A dangling symlink resolves fine from the profile's perspective until the
	// module is actually imported; `existsSync` follows the link, so a dead
	// target shows up as "missing" here rather than at load time.
	const roots = [join(pluginDir, "node_modules")];
	const dangling = [];
	for (const root of roots) {
		for (const scope of ["", "@deepseek-ai"]) {
			for (const entry of entriesOf(join(root, scope))) {
				let stat;
				try {
					stat = lstatSync(entry.path);
				} catch {
					continue;
				}
				if (stat.isSymbolicLink() && !existsSync(entry.path)) {
					dangling.push(entry.path.replace(pluginDir, ""));
				}
			}
		}
	}
	assert.deepEqual(dangling, [], `dangling dependency symlinks (host would fail to import): ${dangling.join(", ")}`);
});

test("every declared runtime dependency is present and resolvable", () => {
	const missing = [];
	for (const name of Object.keys(pkg.dependencies ?? {})) {
		const target = join(pluginDir, "node_modules", ...name.split("/"));
		if (!existsSync(target)) missing.push(name);
	}
	assert.deepEqual(missing, [], `declared dependencies missing from node_modules: ${missing.join(", ")}`);
});

test("devDependency specs are ranges, never exact prerelease pins", () => {
	// An exact prerelease pin ERESOLVEs against a sibling package published only
	// at a different prerelease of the same version (documented in CHANGELOG
	// 1.2.2, and re-hit during the 0.1.7 adaptation). Ranges are required.
	const offenders = [];
	for (const [name, spec] of Object.entries(pkg.devDependencies ?? {})) {
		if (/^\d/.test(spec) && spec.includes("-")) offenders.push(`${name}@${spec}`);
	}
	assert.deepEqual(offenders, [], `devDependencies pinned to an exact prerelease: ${offenders.join(", ")}`);
});
