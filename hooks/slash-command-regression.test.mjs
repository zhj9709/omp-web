import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const sessionSource = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { buildSlashCommandLayout } = await jiti.import("../components/ChatInput.tsx");

test("unknown slash commands return an explicit error instead of falling through to a prompt", () => {
  const fnStart = sessionSource.indexOf("handleBuiltinSlashCommand");
  const defaultSource = sessionSource.slice(fnStart);
  assert.match(defaultSource, /default:/);
  assert.match(defaultSource, /OMP_EXECUTABLE_SLASH_COMMANDS\[commandName\]/);
  assert.match(defaultSource, /TUI_ONLY_SLASH_COMMANDS\[commandName\]/);
  assert.match(defaultSource, /return \{ handled: false \}/);
  assert.match(defaultSource, /handled: true, error: `Unknown command/);
});

test("/model maps to get_state without args and set_model with a provider/model pair", () => {
  const fnStart = sessionSource.indexOf("handleBuiltinSlashCommand");
  const modelSource = sessionSource.slice(fnStart);
  assert.match(modelSource, /case "model"/);
  assert.match(modelSource, /type: "get_state"/);
  assert.match(modelSource, /type: "set_model", provider, modelId/);
});

test("TUI-renamed commands are forwarded to OMP instead of local RPC calls", () => {
  const slashSource = sessionSource.slice(
    sessionSource.indexOf("const handleBuiltinSlashCommand = useCallback"),
    sessionSource.indexOf("// Let AgentSession.prompt decide"),
  );
  // /reload and /name no longer exist; /rename and /reload-plugins are
  // forwarded through the OMP-executable list.
  assert.doesNotMatch(slashSource, /case "reload":/);
  assert.doesNotMatch(slashSource, /case "name":/);
  assert.match(sessionSource, /rename: true/);
  assert.match(sessionSource, /"reload-plugins": true/);
  assert.match(slashSource, /type: "prompt", message: text, streamingBehavior: "steer"/);
});

test("TUI-only commands and settings/new/quit/resume are handled locally", () => {
  const slashSource = sessionSource.slice(
    sessionSource.indexOf("const handleBuiltinSlashCommand = useCallback"),
    sessionSource.indexOf("// Let AgentSession.prompt decide"),
  );
  assert.match(slashSource, /case "settings"/);
  assert.match(slashSource, /opts\.onOpenSettings\?\.\(\)/);
  assert.match(slashSource, /case "new"/);
  assert.match(slashSource, /opts\.onOpenNewSession\?\.\(cwd\)/);
  assert.match(slashSource, /case "quit"/);
  assert.match(slashSource, /case "resume"/);
  assert.match(slashSource, /is a TUI-only command/);
});

test("SlashCommandInfo.source accepts builtin, custom, file, and mcp_prompt origins", () => {
  assert.match(
    sessionSource,
    /source:\s*"extension"\s*\|\s*"prompt"\s*\|\s*"skill"\s*\|\s*"builtin"\s*\|\s*"custom"\s*\|\s*"file"\s*\|\s*"mcp_prompt"/,
  );
});

test("the slash palette renders custom and file command sources", () => {
  const layout = buildSlashCommandLayout([
    { name: "mycustom", description: "c", source: "custom" },
    { name: "myfile", description: "f", source: "file" },
  ], {});
  const sources = layout.groups.map((group) => group.source);
  assert.ok(sources.includes("custom"), "expected a custom group");
  assert.ok(sources.includes("file"), "expected a file group");
  assert.equal(layout.commands.length, 2);
});
