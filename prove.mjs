import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Same rationale as integration.mjs: `import.meta.dirname` needs Node >= 20.11.
const root = dirname(fileURLToPath(import.meta.url));

const result = spawnSync(process.execPath, ["--test", "plugin/test/traceable-proxy.test.mjs"], {
	cwd: root,
	stdio: "inherit"
});

process.exitCode = result.status ?? 1;
