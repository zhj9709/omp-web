import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseModelsYaml } = await jiti.import("./omp-models.ts");

test("strips apiKey from parsed providers", () => {
  const parsed = parseModelsYaml([
    "providers:",
    "  openai:",
    "    apiKey: sk-secret-123",
    "    baseUrl: https://api.openai.com/v1",
  ].join("\n"));
  const providers = parsed.providers;
  assert.equal(providers.openai.apiKey, undefined);
  assert.equal(providers.openai.baseUrl, "https://api.openai.com/v1");
});

test("strips alternate credential spellings", () => {
  const parsed = parseModelsYaml([
    "providers:",
    "  a:",
    "    api_key: k1",
    "  b:",
    "    token: k2",
    "  c:",
    "    accessToken: k3",
    "  d:",
    "    secret: k4",
    "  e:",
    "    authorization: Bearer k5",
    "  f:",
    "    api-key: k6",
  ].join("\n"));
  const providers = parsed.providers;
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    assert.deepEqual(
      Object.keys(providers[id] ?? {}),
      [],
      `provider ${id} should expose no credential fields`,
    );
  }
});

test("never stores header blocks or inline header values", () => {
  const inline = parseModelsYaml([
    "providers:",
    "  g:",
    "    headers: { Authorization: Bearer k7 }",
    "    baseUrl: https://g.example",
  ].join("\n"));
  const inlineProviders = inline.providers;
  assert.equal(inlineProviders.g.headers, undefined);
  assert.equal(inlineProviders.g.baseUrl, "https://g.example");

  const block = parseModelsYaml([
    "providers:",
    "  h:",
    "    headers:",
    "      Authorization: Bearer k8",
  ].join("\n"));
  const blockProviders = block.providers;
  assert.equal(blockProviders.h.headers, undefined);
});

test("skips nested discovery and modelOverrides blocks", () => {
  const parsed = parseModelsYaml([
    "providers:",
    "  i:",
    "    baseUrl: https://i.example",
    "    discovery:",
    "      enabled: true",
    "    modelOverrides:",
    "      x: y",
  ].join("\n"));
  const providers = parsed.providers;
  assert.equal(providers.i.baseUrl, "https://i.example");
  assert.deepEqual(Object.keys(providers.i), ["baseUrl"]);
});

test("ignores comments and blank lines", () => {
  const parsed = parseModelsYaml([
    "# comment",
    "providers:",
    "",
    "  j:",
    "    # inner comment",
    "    baseUrl: https://j.example",
  ].join("\n"));
  const providers = parsed.providers;
  assert.equal(providers.j.baseUrl, "https://j.example");
});

test("parses scalar values with type inference", () => {
  const parsed = parseModelsYaml([
    "providers:",
    "  k:",
    "    baseUrl: https://k.example",
    "    enabled: true",
    "    count: 3",
  ].join("\n"));
  const providers = parsed.providers;
  assert.equal(providers.k.enabled, true);
  assert.equal(providers.k.count, 3);
});
