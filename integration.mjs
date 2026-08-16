import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--test", "plugin/test/default-model.test.mjs"], {
	cwd: import.meta.dirname,
	stdio: "inherit"
});

process.exitCode = result.status ?? 1;
