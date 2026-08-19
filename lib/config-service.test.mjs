import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { load } from "js-yaml";

const jiti = createJiti(import.meta.url);
const {
  mergeConfigEntries,
  readClientConfig,
  writeConfigEntries,
  ConfigValidationError,
} = await jiti.import("./config-service.ts");

const DISK = {
  display: { showTokenUsage: true, hideToolActivity: false },
  searxng: { endpoint: "https://sx.example", token: "sekret-token" },
  theme: { dark: "dark-nord" },
};

test("merge overwrites plain keys and creates nesting", () => {
  const next = mergeConfigEntries(DISK, { "display.showTokenUsage": false, "tui.tight": true });
  assert.equal(next.display.showTokenUsage, false);
  assert.equal(next.display.hideToolActivity, false); // untouched
  assert.equal(next.tui.tight, true);
  assert.equal(next.searxng.endpoint, "https://sx.example"); // preserved
});

test("credential keys keep the stored secret on empty or redacted values", () => {
  for (const v of ["", "__set__", undefined]) {
    const next = mergeConfigEntries(DISK, { "searxng.token": v });
    assert.equal(next.searxng.token, "sekret-token");
  }
  const replaced = mergeConfigEntries(DISK, { "searxng.token": "new-token" });
  assert.equal(replaced.searxng.token, "new-token");
});

test("merge never mutates the input config", () => {
  mergeConfigEntries(DISK, { "display.showTokenUsage": false });
  assert.equal(DISK.display.showTokenUsage, true);
});

test("rejects bad entries and malformed keys", () => {
  assert.throws(() => mergeConfigEntries(DISK, null), ConfigValidationError);
  assert.throws(() => mergeConfigEntries(DISK, { "": 1 }), ConfigValidationError);
  assert.throws(() => mergeConfigEntries(DISK, { "a..b": 1 }), ConfigValidationError);
});

test("readClientConfig redacts credential values to __set__", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-config-"));
  const path = join(dir, "config.yml");
  writeFileSync(path, "searxng:\n  endpoint: https://sx.example\n  token: topsecret\n");
  const client = readClientConfig(path);
  assert.equal(client.searxng.token, "__set__");
  assert.equal(client.searxng.endpoint, "https://sx.example");
});

test("writeConfigEntries persists with backup and 0600", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-config-"));
  const path = join(dir, "config.yml");
  writeFileSync(path, "display:\n  showTokenUsage: true\nsearxng:\n  token: keepme\n");

  await writeConfigEntries({ "display.hideToolActivity": true, "searxng.token": "" }, path);

  const onDisk = load(readFileSync(path, "utf8"));
  assert.equal(onDisk.display.showTokenUsage, true);
  assert.equal(onDisk.display.hideToolActivity, true);
  assert.equal(onDisk.searxng.token, "keepme");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(readdirSync(dir).filter((f) => f.startsWith("config.yml.bak-")).length, 1);
});
