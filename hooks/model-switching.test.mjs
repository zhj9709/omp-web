import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const loaderSource = await readFile(new URL("./agent-session/session-loader.ts", import.meta.url), "utf8");
const commandsSource = await readFile(new URL("./agent-session/commands.ts", import.meta.url), "utf8");
const loadSessionSource = loaderSource.slice(
  loaderSource.indexOf("const loadSession = useCallback"),
  loaderSource.indexOf("const loadContext = useCallback"),
);
const switchSource = commandsSource.slice(
  commandsSource.indexOf("const handleModelChange = useCallback"),
  commandsSource.indexOf("const handleCompact = useCallback"),
);

test("existing-session model changes are optimistic and serialized", () => {
  const optimisticIndex = switchSource.indexOf("setCurrentModelOverride(target)");
  const requestIndex = switchSource.indexOf("await sendAgentCommand", optimisticIndex);

  assert.match(switchSource, /if \(!sid \|\| modelSwitchPendingRef\.current\) return/);
  assert.ok(optimisticIndex >= 0);
  assert.ok(requestIndex > optimisticIndex);
  assert.match(switchSource, /setModelSwitching\(true\)/);
  assert.match(switchSource, /setModelSwitching\(false\)/);
});

test("session reloads cannot clear an in-flight optimistic model", () => {
  assert.match(
    loadSessionSource,
    /setCurrentModelOverride\(\(current\) => modelSwitchPendingRef\.current \? current : null\)/,
  );
});

test("a completed model switch reloads canonical session state and reports failures", () => {
  assert.match(switchSource, /modelSwitchPendingRef\.current = false;\s*await loadSession\(sid\)/);
  assert.match(switchSource, /setCurrentModelOverride\(previousOverride\)/);
  assert.match(switchSource, /Failed to switch model:/);
});
