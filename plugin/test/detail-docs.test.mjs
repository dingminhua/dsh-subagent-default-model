// Regression guard for the plugin-detail document contract (DSH 0.2.2+).
//
// The Plugins page renders a long, scrollable block under each plugin: a
// "detail document". The host resolves it like this (`dsh-plugin-detail`,
// `readPackageDocument` / `localeDetail`):
//
//   1. walk the language chain (`zh-CN` → `zh` → `en`) reading
//      `locale/<language>.json`;
//   2. use the first `meta.detail` that is DECLARED — a locale file that exists
//      without one does not stop the walk, the chain continues;
//   3. read the Markdown that path names;
//   4. if NO locale declares `meta.detail`, fall back to the package README.
//
// Our README is hundreds of lines, so without these files the Plugins page
// dumps all of it into a 560px box. That is what this guard prevents from
// silently coming back.
//
// The failure modes are asymmetric and worth pinning separately:
//
//   - a MISSING `locale/en.json` detail is silent: the English UI just falls
//     back to the README, which nobody notices during a zh review;
//   - a detail path that names a file which does not exist is NOT silent: the
//     host reports `invalid` and renders an error with a Retry button, which is
//     worse than the README it was meant to replace;
//   - a file left out of `package.json#files` is invisible in the repo and
//     missing only in the published tarball, i.e. it fails exactly where nobody
//     tests.
//
// So each of those gets its own assertion against the REAL package layout.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { posix } from "node:path";

const ROOT = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));

/** Characters the host's 100-character budget counts: everything, trailing whitespace excluded. */
function budget(markdown) {
	return [...markdown.replace(/\s+$/u, "")].length;
}

/** Every `locale/*.json` in the package, as `{ name, path, json }`. */
function localeFiles() {
	const dir = new URL("locale/", ROOT);
	assert.ok(existsSync(dir), "a locale/ directory must exist: the host reads meta.detail from it");
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => {
			const path = "locale/" + name;
			return { name, path, json: JSON.parse(readFileSync(new URL(path, ROOT), "utf8")) };
		});
}

/** The host's own validation rules for `meta.detail` (`detailPath`). */
function assertValidDetailPath(value, label) {
	assert.equal(typeof value, "string", `${label} must be a string`);
	assert.ok(value.trim() !== "", `${label} must not be empty`);
	assert.ok(!value.includes("\\"), `${label} must use forward slashes`);
	assert.ok(!/^[A-Za-z][A-Za-z\d+.-]*:/u.test(value), `${label} must not carry a URL scheme`);
	for (const segment of value.split("/")) {
		assert.ok(segment !== "" && segment !== "." && segment !== "..", `${label} must stay inside the package: ${value}`);
	}
	assert.match(value, /\.(?:md|markdown)$/iu, `${label} must name a Markdown file: ${value}`);
}

/** Whether `package.json#files` (a whitelist) actually ships `path`. */
function isShipped(path) {
	const files = pkg.files ?? [];
	return files.some((entry) => {
		const normalized = entry.replace(/\/+$/u, "");
		return path === normalized || path.startsWith(normalized + "/");
	});
}

test("every locale declares meta.detail (en.json is the final fallback and must not be skipped)", () => {
	const locales = localeFiles();
	assert.ok(locales.length > 0, "expected at least one locale file");
	for (const { path, json } of locales) {
		assert.ok(json.meta !== null && typeof json.meta === "object", `${path}: meta must be an object`);
		assert.ok(
			json.meta.detail !== undefined,
			`${path}: meta.detail is required — a locale without it is skipped, and if NONE declares one the host renders the whole README`
		);
		assertValidDetailPath(json.meta.detail, `${path}: meta.detail`);
	}
	// `en` is the tail of the language chain, so it carries every language that
	// was not given its own file. A missing en detail means the English UI (and
	// every unlisted language) silently falls back to the README.
	const en = locales.find((locale) => locale.name === "en.json");
	assert.ok(en !== undefined, "locale/en.json must exist: it is the final fallback of the language chain");
	assert.ok(en.json.meta.detail !== undefined, "locale/en.json must declare meta.detail");
});

test("every meta.detail names a real Markdown file inside the package", () => {
	for (const { path, json } of localeFiles()) {
		const target = json.meta.detail;
		assert.equal(typeof target, "string", `${path}: meta.detail must be a string`);
		const file = new URL(target, ROOT);
		assert.ok(
			existsSync(file),
			`${path}: meta.detail names "${target}", which does not exist. The host does NOT fall back to the README for this — it reports "invalid" and renders an error with a Retry button.`
		);
		const markdown = readFileSync(file, "utf8");
		assert.ok(markdown.trim() !== "", `${path}: "${target}" must not be empty`);
		// The host strips a leading front matter block and ignores raw HTML; a
		// document made only of those would render as an empty box.
		assert.ok(!/^\uFEFF/u.test(markdown), `${target}: must be UTF-8 without a BOM`);
		assert.ok(!/^---\r?\n/u.test(markdown), `${target}: front matter is stripped by the host, so it cannot carry the text`);
	}
});

test("every detail document fits the host's 100-character budget", () => {
	// The budget is CHARACTERS, not words: CJK, punctuation, letters and spaces
	// all count. The host caps the document at 1 MiB, so this is purely about
	// the copy staying a short summary rather than a second README.
	for (const { path, json } of localeFiles()) {
		const markdown = readFileSync(new URL(json.meta.detail, ROOT), "utf8");
		const used = budget(markdown);
		assert.ok(used <= 100, `${path}: "${json.meta.detail}" is ${used} characters, over the 100-character budget`);
		assert.ok(used >= 40, `${path}: "${json.meta.detail}" is only ${used} characters — too terse to describe the plugin`);
	}
});

test("every detail document and every locale file actually ships in the tarball", () => {
	// A file that exists in the repo but is missing from `files` fails only in
	// the published package — the one place nobody runs the tests.
	for (const { path, json } of localeFiles()) {
		assert.ok(isShipped(path), `${path} is not covered by package.json#files, so it never reaches the published tarball`);
		const target = json.meta.detail;
		assert.ok(
			isShipped(target),
			`"${target}" is not covered by package.json#files — add the exact path rather than relying on a parent directory`
		);
	}
	// The locale directory itself must ship: without it the host finds no
	// meta.detail at all and silently renders the README.
	assert.ok(isShipped("locale/zh.json"), "package.json#files must include the locale directory (or each locale file)");
});

test("detail paths resolve inside the package root and stay portable", () => {
	for (const { path, json } of localeFiles()) {
		const target = json.meta.detail;
		// `posix.join` is what the host effectively does; a path that normalises
		// to something else than itself would resolve to a different file.
		assert.equal(posix.normalize(target), target, `${path}: "${target}" must already be normalised`);
		assert.ok(!target.startsWith("/"), `${path}: "${target}" must be package-root relative, not absolute`);
	}
});
