import { Context } from "/Users/dmh2002/.npm/_npx/6c7f445d1bf61956/node_modules/@deepseek-ai/cordis/lib/index.js";
import { SettingsProvider } from "/Users/dmh2002/.npm/_npx/6c7f445d1bf61956/node_modules/@deepseek-ai/dsh-settings/lib/index.js";
import { apply as applyToolSubagent } from "/Users/dmh2002/.npm/_npx/6c7f445d1bf61956/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js";

// --- root + real settings provider seeded with the section ---
const root = new Context();
class FileLike extends SettingsProvider {
    async load() {
        return { "subagent-default-model": { provider: "deepseek-official", model: "deepseek-v4-pro" } };
    }
    get writable() { return false; }
}
const settings = new FileLike(root, "settings");
await settings.load().then((doc) => settings.publish(doc));
await root[Symbol.for("cordis.init")]?.();  // ensure effects run

// --- agent-like child context ---
const agentCtx = root.extend();
agentCtx.fiber = root.fiber; // reuse root fiber for service visibility

let capturedRequest = null;
const fakeProvider = {
    name: "spawn",
    capabilities: { depthLimit: true },
    inheritsParentContext: false,
    start: async (config, request) => {
        capturedRequest = request;
        return {
            result: Promise.resolve({ stopReason: "completed", output: [{ type: "text", text: "ok" }] }),
            dispose: async () => {},
        };
    },
};

// stub services the plugin needs
root.provide("tools", {
    register: (tool) => { registeredTool = tool; return () => {}; },
    get: () => undefined,
});
root.provide("subagents", {
    getProvider: (name) => (name === "spawn" ? fakeProvider : undefined),
    start: fakeProvider.start,
});
root.provide("systemPrompt", { section: () => {} });

let registeredTool = null;
applyToolSubagent(agentCtx, { provider: "spawn", toolName: "subagent", backgroundMode: "one-shot", enableRunInBackground: false });

// let inject callbacks settle
await new Promise((r) => setTimeout(r, 50));

if (!registeredTool) { console.log("FATAL: tool not registered"); process.exit(1); }

// --- execute the tool the way the model would ---
await registeredTool.execute(
    { description: "probe", prompt: "reply ok", run_in_background: false },
    { agent: { options: { provider: "deepseek-official", model: "deepseek-v4-flash", maxTokens: 256000 } }, signal: new AbortController().signal }
);

console.log("captured request.agentOptions:", JSON.stringify(capturedRequest?.agentOptions ?? "undefined (no agentOptions)"));
console.log("expected (fixed):", JSON.stringify({ provider: "deepseek-official", model: "deepseek-v4-pro" }));
