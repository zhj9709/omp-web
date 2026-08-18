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

test("unmapped slash commands return an explicit error instead of falling through to a prompt", () => {
  const fnStart = sessionSource.indexOf("handleBuiltinSlashCommand");
  const defaultSource = sessionSource.slice(fnStart);
  assert.match(defaultSource, /default:/);
  assert.match(defaultSource, /commandName\.startsWith\("skill:"\)/);
  assert.match(defaultSource, /return \{ handled: false \}/);
  assert.match(defaultSource, /handled: true, error:/);
});

test("/model maps to get_state without args and set_model with a provider/model pair", () => {
  const fnStart = sessionSource.indexOf("handleBuiltinSlashCommand");
  const modelSource = sessionSource.slice(fnStart);
  assert.match(modelSource, /case "model"/);
  assert.match(modelSource, /type: "get_state"/);
  assert.match(modelSource, /type: "set_model"/);
});

test("/reload performs a pure client-side reload without an RPC call", () => {
  const reloadSource = sessionSource.slice(
    sessionSource.indexOf('case "reload"'),
    sessionSource.indexOf('case "name"'),
  );
  assert.doesNotMatch(reloadSource, /sendAgentCommand/);
  assert.match(reloadSource, /loadSession\(sid, false, true\)/);
  assert.match(reloadSource, /loadTools\(sid\)/);
  assert.match(reloadSource, /loadSlashCommands\(\)/);
  assert.match(reloadSource, /loadModels\(\)/);
});

test("SlashCommandInfo.source accepts builtin, custom, and file origins", () => {
  assert.match(
    sessionSource,
    /source:\s*"extension"\s*\|\s*"prompt"\s*\|\s*"skill"\s*\|\s*"builtin"\s*\|\s*"custom"\s*\|\s*"file"/,
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
