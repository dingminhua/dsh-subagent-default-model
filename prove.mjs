import { Context, Service } from "/Users/dmh2002/.npm/_npx/6c7f445d1bf61956/node_modules/@deepseek-ai/cordis/lib/index.js";

const root = new Context();
class FakeSettings extends Service {}
const svc = new FakeSettings(root, "settings");

const applyTime = root.get("settings");          // what the tool does in apply()
const executeTime = root.get("settings");        // what the tool does in execute()

console.log("=== traceable proxy identity ===");
console.log("applyTime === executeTime          :", applyTime === executeTime, "(same object expected for a WeakMap key)");
console.log("applyTime === svc (raw)            :", applyTime === svc);

console.log("\n=== original (patched 06:04) behavior ===");
const settingsInstalled = new WeakSet();
const settingsSources = new WeakMap();
settingsInstalled.add(applyTime);
settingsSources.set(applyTime, () => ({ provider: "deepseek-official", model: "deepseek-v4-pro" }));
const guardSecondInstance = settingsInstalled.has(root.get("settings"));
const sectionRead = settingsSources.get(root.get("settings"))?.();
console.log("guard sees second instance as new  :", !guardSecondInstance, "(-> duplicate registration attempt)");
console.log("settingsSources lookup at execute  :", sectionRead ?? "undefined  <-- BUG: fallback never fires");

console.log("\n=== fixed behavior (stable raw key) ===");
const raw = (s) => s?.[Symbol.for("cordis.original")] ?? s;
settingsInstalled.add(raw(applyTime));
settingsSources.set(raw(applyTime), () => ({ provider: "deepseek-official", model: "deepseek-v4-pro" }));
console.log("guard dedupes second instance      :", settingsInstalled.has(raw(root.get("settings"))));
console.log("settingsSources lookup at execute  :", JSON.stringify(settingsSources.get(raw(root.get("settings")))?.()), "<-- fallback fires");
