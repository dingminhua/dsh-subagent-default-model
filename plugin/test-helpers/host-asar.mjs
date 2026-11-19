// Readers for the DSH installation on this machine, shared by the guards that
// have to look INSIDE it.
//
// Two tests need this and neither can use `import` to reach the host: the
// installation lives in an `app.asar`, which is one archive file, so plain
// Node ESM cannot import anything out of it. The archive format is trivial
// enough to parse by hand, and doing so here keeps the semantics in one place
// instead of two copies drifting apart.
//
// WHY THIS FILE IS NOT UNDER `test/`. `node --test` discovers every `.mjs` it
// finds beneath `test/` and runs it as a test file. When this helper lived
// there it was executed as a suite of its own: it reported `✔` (a file that
// throws nothing "passes") and inflated the count by one, so the suite claimed
// 199 tests while asserting the same 198 things. A module that is not a test
// must live outside the discovery path.

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/** Candidate host bundles on this machine, `DSH_APP_BOOT` first. */
export const HOST_HOMES = [
	process.env.DSH_APP_BOOT,
	"/Applications/DeepSeek Harness.app/Contents/Resources/app.asar",
	"/Applications/DSH Desktop.app/Contents/Resources/app.asar",
	"/Applications/DSH NEXT.app/Contents/Resources/app.asar"
].filter((value) => typeof value === "string" && value !== "");

/** The host package directory inside a bundle: `dsh/node_modules/@deepseek-ai/`. */
const HOST_PACKAGES = ["dsh", "node_modules", "@deepseek-ai"];

/**
 * Read one file's text out of the host bundle, from every candidate home.
 *
 * An already-extracted tree (the review workflow's layout) is read directly;
 * an `app.asar` goes through {@link readFileFromAsar}. Unreadable candidates
 * are skipped, not fatal: a different app layout is not this test's subject.
 *
 * @param {readonly string[]} segments - path segments below `@deepseek-ai/`.
 * @returns {string|undefined} the first readable copy, or `undefined`.
 */
export function readHostFile(segments) {
	const relative = join(...HOST_PACKAGES, ...segments);
	for (const home of HOST_HOMES) {
		try {
			if (existsSync(home) && statSync(home).isDirectory()) {
				const direct = join(home, relative);
				if (existsSync(direct)) return readFileSync(direct, "utf8");
				continue;
			}
			if (!home.endsWith(".asar")) continue;
			const text = readFileFromAsar(home, [...HOST_PACKAGES, ...segments].join("/"));
			if (text !== undefined) return text;
		} catch {
			// Different layout, corrupt archive, or unreadable file; keep looking.
		}
	}
	return undefined;
}

/**
 * Read the version of the DSH Desktop installation on this machine.
 *
 * The host's own version lives in `dsh/node_modules/@deepseek-ai/dsh/package.json`
 * inside the app bundle.
 *
 * @param {readonly string[]} [homes] - candidate app.asar paths, or a plugin dir.
 * @returns {string|undefined} the host version, or `undefined` when not found.
 */
export function findRunningHostVersion(homes = HOST_HOMES) {
	const relative = join(...HOST_PACKAGES, "dsh", "package.json");
	const posixPath = [...HOST_PACKAGES, "dsh", "package.json"].join("/");
	for (const home of homes) {
		try {
			let text;
			if (existsSync(home) && statSync(home).isDirectory()) {
				const direct = join(home, relative);
				if (!existsSync(direct)) continue;
				text = readFileSync(direct, "utf8");
			} else if (home.endsWith(".asar")) {
				text = readFileFromAsar(home, posixPath);
				if (text === undefined) continue;
			} else {
				continue;
			}
			const version = JSON.parse(text).version;
			if (typeof version === "string") return version;
		} catch {
			// Different layout, corrupt archive, or unreadable file; keep looking.
		}
	}
	return undefined;
}

/**
 * Read one file's bytes out of an `app.asar` archive, without any dependency.
 *
 * Layout: four little-endian uint32s — `4` (pickle header) | payload size |
 * padded JSON string size | UNPADDED JSON length — then the JSON directory
 * tree, then a payload whose file offsets are relative to the end of the
 * preamble + header. The third and fourth words look interchangeable and are
 * not: the third is padded to 4 bytes and includes the trailing padding, so
 * parsing it yields `Unexpected non-whitespace character after JSON`.
 *
 * THE PAYLOAD BASE IS `8 + headerSize`, NOT `16 + headerSize`. The header is
 * itself a pickle: the four words ARE that pickle's framing, the JSON
 * directory tree starts at byte 16, and the payload starts at byte
 * `8 + headerSize`. Reading with `16 + headerSize` lands 8 bytes too far in:
 * every file comes back with its first 8 bytes REPLACED by the tail of the
 * previous file and its last 8 bytes cut off.
 *
 * That mistake stayed invisible for years, because the only reader of this
 * helper searched the text for a substring (`function unmetRequirements(`)
 * and a shifted copy still contains it. Reading a file AS JSON — which the
 * running-host-version check does — turns the same shift into a hard parse
 * error: the text starts mid-token (`e": "@deepseek-ai/dsh", …`).
 *
 * @param {string} archive - path to the `.asar` file.
 * @param {string} archivePath - POSIX-style path inside the archive.
 * @returns {string|undefined} UTF-8 contents, or `undefined` when absent/unpacked.
 */
export function readFileFromAsar(archive, archivePath) {
	const fd = openSync(archive, "r");
	try {
		const preamble = Buffer.alloc(16);
		if (readSync(fd, preamble, 0, 16, 0) !== 16) return undefined;
		if (preamble.readUInt32LE(0) !== 4) return undefined;
		const headerSize = preamble.readUInt32LE(4);
		const jsonSize = preamble.readUInt32LE(12);
		if (jsonSize === 0 || jsonSize > headerSize) return undefined;
		const header = Buffer.alloc(headerSize);
		if (readSync(fd, header, 0, headerSize, 16) !== headerSize) return undefined;
		let node = JSON.parse(header.subarray(0, jsonSize).toString("utf8"));
		for (const segment of archivePath.split("/")) {
			node = node?.files?.[segment];
			if (node === void 0) return undefined;
		}
		// An unpacked entry lives in `app.asar.unpacked/`, not in the archive.
		if (node.files !== void 0 || node.unpacked === true) return undefined;
		const bytes = Buffer.alloc(Number(node.size));
		const at = 8 + headerSize + Number(node.offset);
		if (readSync(fd, bytes, 0, bytes.length, at) !== bytes.length) return undefined;
		return bytes.toString("utf8");
	} finally {
		closeSync(fd);
	}
}
