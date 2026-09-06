import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const newSessionFlowSource = await readFile(new URL("./agent-session/new-session.ts", import.meta.url), "utf8");
const modelsSource = await readFile(new URL("./agent-session/models.ts", import.meta.url), "utf8");

test("new-session startup sends only explicit browser overrides", () => {
  const ensureSource = newSessionFlowSource.slice(
    newSessionFlowSource.indexOf("const ensureNewSession"),
  );

  assert.match(ensureSource, /const selectedModel = newSessionModelOverrideRef\.current;/);
  assert.doesNotMatch(ensureSource, /newSessionModel \?\? newSessionDefaultModel/);
  assert.match(ensureSource, /const selectedThinkingLevel = thinkingLevelOverrideRef\.current;/);
  assert.doesNotMatch(ensureSource, /thinkingLevel !== "auto"/);
});

test("new-session startup adopts server state only while explicit overrides are unchanged", () => {
  const ensureSource = newSessionFlowSource.slice(
    newSessionFlowSource.indexOf("const ensureNewSession"),
  );

  assert.match(
    ensureSource,
    /result\.model && newSessionModelOverrideRef\.current === selectedModel/,
  );
  assert.match(ensureSource, /setPendingModel\(result\.model\)/);
  assert.match(ensureSource, /setNewSessionDefaultModel\(result\.model\)/);
  assert.match(
    ensureSource,
    /thinkingLevelOverrideRef\.current === selectedThinkingLevel/,
  );
  assert.match(ensureSource, /setThinkingLevel\(result\.thinkingLevel\)/);
});

test("model-list refresh does not overwrite a live session or explicit thinking override", () => {
  const loadModelsSource = modelsSource.slice(
    modelsSource.indexOf("const loadModels = useCallback"),
    modelsSource.indexOf("  // Load model list"),
  );

  assert.match(loadModelsSource, /if \(isNew && !sessionIdRef\.current\)/);
  assert.match(
    loadModelsSource,
    /thinkingLevelOverrideRef\.current === null/,
  );
  assert.match(loadModelsSource, /setThinkingLevel\(\(pinned[\s\S]*\?\? "auto"\)/);
});
