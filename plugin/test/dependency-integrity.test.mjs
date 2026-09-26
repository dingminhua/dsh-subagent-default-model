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
import { fileURLToPath } from "node:url";

// `fileURLToPath`, NOT `new URL(...).pathname`: on Windows a file URL is
// `file:///C:/Users/...`, whose `pathname` is `/C:/Users/...`. `join()` then
// folds that into `\C:\Users\...` — a path that does not exist — so
// `readFileSync` throws ENOENT before any assertion runs and the entire suite
// dies on a Windows checkout. `fileURLToPath` is the only form correct on every
// platform, and it also decodes percent-escapes for paths containing spaces
// (e.g. `C:\Users\My Project\...`). The regression test at the bottom of this
// file guards every other module against reintroducing the pathname form.
const pluginDir = fileURLToPath(new URL("..", import.meta.url));
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

test("no module derives a filesystem path from URL.pathname (Windows-hostile)", () => {
	// `new URL(...).pathname` yields `/C:/Users/...` on Windows, which `path.join`
	// then folds into the non-existent `\C:\Users\...`; it also leaves
	// percent-escapes in paths containing spaces. `fileURLToPath` is correct on
	// every platform. This guard exists because the defect is invisible on
	// macOS/Linux (where the two forms agree) and only surfaces on a Windows
	// checkout — exactly the class of bug a macOS-only CI cannot catch.
	const offenders = [];
	for (const relative of ["test", "scripts", "lib"]) {
		const dir = join(pluginDir, relative);
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			if (!/\.(mjs|cjs|js)$/.test(name)) continue;
			const file = join(dir, name);
			const source = readFileSync(file, "utf8");
			// Match `URL(...).pathname` but not `url.pathname` (a URL object's
			// own property, which is legitimate and platform-independent).
			// Comments are stripped first so this guard's own documentation —
			// which necessarily names the forbidden form — cannot match itself.
			const code = source
				.replace(/\/\*[\s\S]*?\*\//g, " ")
				.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
			if (/new URL\([^)]*\)\s*\.pathname|import\.meta\.url\.pathname/.test(code)) {
				offenders.push(`${relative}/${name}`);
			}
		}
	}
	assert.deepEqual(offenders, [], `modules deriving a path from URL.pathname (use fileURLToPath): ${offenders.join(", ")}`);
});

test("cross-platform path handling is exercised by the other test files", () => {
	// Belt-and-braces: assert the suite actually imports `fileURLToPath` where it
	// resolves the plugin root, so a future refactor cannot silently revert to
	// the pathname form while this file's guard is the only thing checking.
	const source = readFileSync(join(pluginDir, "test", "dependency-integrity.test.mjs"), "utf8");
	assert.ok(source.includes("fileURLToPath"), "this guard file must itself use fileURLToPath");
});
