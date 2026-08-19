import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { load } from "js-yaml";

const jiti = createJiti(import.meta.url);
const { mergeModelsConfig, writeModelsConfig, ModelsConfigValidationError } =
  await jiti.import("./models-config-writer.ts");

const DISK_YAML = [
  "providers:",
  "  acme:",
  "    baseUrl: https://api.acme.test/v1",
  "    api: openai-completions",
  "    apiKey: sk-real-secret",
  "    authHeader: true",
  "    discovery:",
  "      type: proxy",
  "    modelOverrides:",
  "      BigModel:",
  "        contextWindow: 1000000",
  "  oldname:",
  "    baseUrl: https://old.test/v1",
  "    api: openai-completions",
  "    apiKey: sk-old-key",
  "",
].join("\n");

const DB_MODELS = [
  { provider: "acme", id: "BigModel", name: "Big Model", api: "openai-completions", contextWindow: 1000000, maxTokens: 8192 },
];

function bodyWithAcme(models) {
  return {
    providers: {
      acme: {
        baseUrl: "https://api.acme.test/v1",
        api: "openai-completions",
        authHeader: true,
        ...(models === undefined ? {} : { models }),
      },
    },
  };
}

/** Drop the provider field — a db-row attribute, not part of the yaml body. */
function toBodyModels(models) {
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    api: m.api,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
  }));
}

test("untouched round-trip preserves credentials and nested blocks", () => {
  const merged = mergeModelsConfig(DISK_YAML, bodyWithAcme(toBodyModels(DB_MODELS)), DB_MODELS);
  const acme = merged.providers.acme;
  assert.equal(acme.apiKey, "sk-real-secret");
  assert.deepEqual(acme.discovery, { type: "proxy" });
  assert.deepEqual(acme.modelOverrides, { BigModel: { contextWindow: 1000000 } });
});

test("untouched models round-trip does not freeze the db listing into yaml", () => {
  const merged = mergeModelsConfig(DISK_YAML, bodyWithAcme(toBodyModels(DB_MODELS)), DB_MODELS);
  assert.equal(merged.providers.acme.models, undefined);
});

test("a reshuffled db listing is not mistaken for an edit", () => {
  const manyModels = [
    { provider: "acme", id: "m-a", name: "A", api: "openai-completions", contextWindow: 1000, maxTokens: 100 },
    { provider: "acme", id: "m-b", name: "B", api: "openai-completions", contextWindow: 2000, maxTokens: 200 },
    { provider: "acme", id: "m-c", name: "C", api: "openai-completions", contextWindow: 3000, maxTokens: 300 },
  ];
  const bodyModels = toBodyModels(manyModels);
  // models.db row order is not stable between reads — the body may carry the
  // same listing in a different order.
  const shuffled = [bodyModels[2], bodyModels[0], bodyModels[1]];
  const merged = mergeModelsConfig(DISK_YAML, bodyWithAcme(shuffled), manyModels);
  assert.equal(merged.providers.acme.models, undefined);
});

test("a provider that exists only in models.db does not land as an empty shell", () => {
  const dbOnly = [{ provider: "ghost", id: "g-1", name: "G", api: "openai-completions", contextWindow: 1, maxTokens: 1 }];
  const body = bodyWithAcme(undefined);
  body.providers.ghost = { models: toBodyModels(dbOnly) };
  const merged = mergeModelsConfig(DISK_YAML, body, dbOnly);
  assert.equal(merged.providers.ghost, undefined);
});

test("scalar edits win over disk", () => {
  const body = bodyWithAcme(undefined);
  body.providers.acme.baseUrl = "https://api2.acme.test/v1";
  const merged = mergeModelsConfig(DISK_YAML, body, DB_MODELS);
  assert.equal(merged.providers.acme.baseUrl, "https://api2.acme.test/v1");
  assert.equal(merged.providers.acme.apiKey, "sk-real-secret");
});

test("a new apiKey overwrites; empty string and undefined keep the stored one", () => {
  const withNew = bodyWithAcme(undefined);
  withNew.providers.acme.apiKey = "sk-new-key";
  assert.equal(mergeModelsConfig(DISK_YAML, withNew, DB_MODELS).providers.acme.apiKey, "sk-new-key");

  const withEmpty = bodyWithAcme(undefined);
  withEmpty.providers.acme.apiKey = "";
  assert.equal(mergeModelsConfig(DISK_YAML, withEmpty, DB_MODELS).providers.acme.apiKey, "sk-real-secret");

  assert.equal(mergeModelsConfig(DISK_YAML, bodyWithAcme(undefined), DB_MODELS).providers.acme.apiKey, "sk-real-secret");
});

test("providers missing from the body are deleted", () => {
  const merged = mergeModelsConfig(DISK_YAML, bodyWithAcme(undefined), DB_MODELS);
  assert.equal(merged.providers.oldname, undefined);
});

test("rename inherits the deleted provider's apiKey via matching baseUrl", () => {
  const body = bodyWithAcme(undefined);
  body.providers.newname = { baseUrl: "https://old.test/v1", api: "openai-completions" };
  const merged = mergeModelsConfig(DISK_YAML, body, DB_MODELS);
  assert.equal(merged.providers.oldname, undefined);
  assert.equal(merged.providers.newname.apiKey, "sk-old-key");
});

test("edited models are written with cost groups completed", () => {
  const edited = [{ id: "BigModel", name: "Big Model", api: "openai-completions", contextWindow: 2000000, maxTokens: 8192, cost: { input: 1 } }];
  const merged = mergeModelsConfig(DISK_YAML, bodyWithAcme(edited), DB_MODELS);
  const models = merged.providers.acme.models;
  assert.equal(models.length, 1);
  assert.equal(models[0].contextWindow, 2000000);
  assert.deepEqual(models[0].cost, { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("rejects a body without a providers object", () => {
  assert.throws(() => mergeModelsConfig(DISK_YAML, { providers: [] }, DB_MODELS), ModelsConfigValidationError);
  assert.throws(() => mergeModelsConfig(DISK_YAML, "nope", DB_MODELS), ModelsConfigValidationError);
});

test("rejects models with an empty id", () => {
  const bad = bodyWithAcme([{ id: "  " }]);
  assert.throws(() => mergeModelsConfig(DISK_YAML, bad, DB_MODELS), /non-empty string "id"/);
});

test("writeModelsConfig persists, backs up, and writes 0600", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-models-"));
  const path = join(dir, "models.yaml");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, DISK_YAML);

  const body = bodyWithAcme(undefined);
  body.providers.acme.baseUrl = "https://changed.test/v1";
  // writeModelsConfig reads the live db for the models comparison; the body
  // carries no models field here, so the db listing is irrelevant.
  await writeModelsConfig(body, path);

  const onDisk = load(readFileSync(path, "utf8"));
  assert.equal(onDisk.providers.acme.baseUrl, "https://changed.test/v1");
  assert.equal(onDisk.providers.acme.apiKey, "sk-real-secret");
  assert.deepEqual(onDisk.providers.acme.discovery, { type: "proxy" });

  const backups = (await import("node:fs")).readdirSync(dir).filter((f) => f.startsWith("models.yaml.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("writeModelsConfig creates the file when missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-models-"));
  const path = join(dir, "models.yaml");
  await writeModelsConfig(bodyWithAcme(undefined), path);
  assert.ok(existsSync(path));
  const onDisk = load(readFileSync(path, "utf8"));
  assert.equal(onDisk.providers.acme.baseUrl, "https://api.acme.test/v1");
  // No disk apiKey existed and the client sent none — nothing is invented.
  assert.equal(onDisk.providers.acme.apiKey, undefined);
});
