import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadSettingsHelpers() {
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  const start = source.indexOf("    function normalizeDefaultModels(value)");
  const end = source.indexOf("    function SubagentModelRow(props)");
  assert.notEqual(start, -1, "settings normalizer must exist");
  assert.notEqual(end, -1, "settings serializer must exist");

  const context = {};
  vm.runInNewContext(`${source.slice(start, end)}\nthis.helpers = { normalizeDefaultModels, serializeDefaultModels, persistDefaultModels };`, context);
  return {
    normalizeDefaultModels(...args) {
      return JSON.parse(JSON.stringify(context.helpers.normalizeDefaultModels(...args)));
    },
    serializeDefaultModels(...args) {
      return JSON.parse(JSON.stringify(context.helpers.serializeDefaultModels(...args)));
    },
    persistDefaultModels(...args) {
      return context.helpers.persistDefaultModels(...args);
    }
  };
}

test("loads legacy fixed model settings as one editable route", async () => {
  const { normalizeDefaultModels } = await loadSettingsHelpers();

  assert.deepEqual(
    normalizeDefaultModels({ provider: "deepseek-official", model: "deepseek-v4-pro" }),
    [{ provider: "deepseek-official", model: "deepseek-v4-pro" }]
  );
});

test("loads string and explicit model-list entries", async () => {
  const { normalizeDefaultModels } = await loadSettingsHelpers();

  assert.deepEqual(
    normalizeDefaultModels({
      provider: "deepseek-official",
      models: ["deepseek-v4-pro", { provider: "kimi", model: "kimi-k3" }]
    }),
    [
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
      { provider: "kimi", model: "kimi-k3" }
    ]
  );
});

test("saves a model list without discarding unrelated settings", async () => {
  const { serializeDefaultModels } = await loadSettingsHelpers();

  assert.deepEqual(
    serializeDefaultModels(
      { unknownFutureSetting: true, model: "legacy" },
      [
        { provider: "deepseek-official", model: "deepseek-v4-pro" },
        { provider: "kimi", model: "kimi-k3" }
      ],
      "random"
    ),
    {
      unknownFutureSetting: true,
      provider: "deepseek-official",
      model: "",
      models: ["deepseek-v4-pro", { provider: "kimi", model: "kimi-k3" }],
      strategy: "random"
    }
  );
});

test("clearing routes retains a schema-valid inherited routing setting", async () => {
  const { serializeDefaultModels } = await loadSettingsHelpers();

  assert.deepEqual(
    serializeDefaultModels(
      {
        unknownFutureSetting: true,
        provider: "deepseek-official",
        model: "deepseek-v4-pro",
        models: ["deepseek-v4-pro", "deepseek-v4-flash"],
        strategy: "round-robin"
      },
      [],
      "round-robin"
    ),
    {
      unknownFutureSetting: true,
      provider: "",
      model: "",
      models: [],
      strategy: "round-robin"
    }
  );
});

test("persists the owned settings fields in revision-safe order", async () => {
  const { persistDefaultModels } = await loadSettingsHelpers();
  const calls = [];
  const scope = {
    async set(field, value) {
      calls.push({ field, value });
    }
  };
  const value = {
    provider: "deepseek-official",
    model: "",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    strategy: "round-robin"
  };

  await persistDefaultModels(scope, value);

  assert.deepEqual(calls, [
    { field: "provider", value: "deepseek-official" },
    { field: "model", value: "" },
    { field: "models", value: ["deepseek-v4-pro", "deepseek-v4-flash"] },
    { field: "strategy", value: "round-robin" }
  ]);
});

test("stops persistence after the first rejected field write", async () => {
  const { persistDefaultModels } = await loadSettingsHelpers();
  const calls = [];
  const scope = {
    async set(field) {
      calls.push(field);
      if (field === "model") throw new Error("write failed");
    }
  };

  await assert.rejects(
    persistDefaultModels(scope, { provider: "deepseek-official", model: "", models: [], strategy: "round-robin" }),
    /write failed/
  );
  assert.deepEqual(calls, ["provider", "model"]);
});
