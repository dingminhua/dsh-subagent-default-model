import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// `fileURLToPath` + `dirname` instead of `import.meta.dirname`: the latter is
// only available from Node 20.11 / 21.2, and it is a plain filesystem path
// (Windows-correct), whereas the older `new URL(...).pathname` idiom is not.
const root = dirname(fileURLToPath(import.meta.url));

const result = spawnSync(process.execPath, ["--test", "plugin/test/default-model.test.mjs"], {
	cwd: root,
	stdio: "inherit"
});

process.exitCode = result.status ?? 1;
