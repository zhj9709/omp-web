import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(
  new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url),
  "utf-8",
);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST, DELETE } = await jiti.import(
  "../app/api/auth/api-key/[provider]/route.ts",
);

function params(provider) {
  return { params: Promise.resolve({ provider }) };
}

test("API key endpoints never call the pi SDK auth login", () => {
  assert.doesNotMatch(source, /apiKeyAuth\.login\(/);
  assert.doesNotMatch(source, /modelRuntime\.login\(/);
  assert.doesNotMatch(source, /storeProviderCredential\(/);
});

test("GET reads provider status from getOmpProviders", () => {
  assert.match(source, /getOmpProviders\(\)/);
  assert.match(source, /hasApiKeyLogin/);
});

test("POST returns 501 feature_unavailable", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/api-key/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-test-placeholder" }),
    }),
    params("openai"),
  );

  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.feature_unavailable, true);
  assert.match(body.error, /not available through the web UI/);
});

test("DELETE returns 501 feature_unavailable", async () => {
  const response = await DELETE(
    new Request("http://localhost/api/auth/api-key/openai", {
      method: "DELETE",
    }),
    params("openai"),
  );

  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.feature_unavailable, true);
});
