import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  OmpSessionWrapper,
  startRpcSession,
  getRpcSession,
} = await jiti.import("./rpc-manager.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockClient() {
  const listeners = [];
  const sent = [];
  return {
    sent,
    onEvent(listener) {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    async send(command) {
      sent.push(command);
      return { type: "response", command: command.type, success: true, data: undefined };
    },
    async sendCommand(command) {
      sent.push(command);
      return undefined;
    },
    dispose() {},
  };
}

function resetRegistry(t) {
  const previousSessions = globalThis.__ompSessions;
  const previousLocks = globalThis.__ompStartLocks;
  globalThis.__ompSessions = new Map();
  globalThis.__ompStartLocks = new Map();
  t.after(() => {
    for (const session of globalThis.__ompSessions?.values() ?? []) {
      try {
        session.destroy();
      } catch {
        // ignore
      }
    }
    globalThis.__ompSessions = previousSessions;
    globalThis.__ompStartLocks = previousLocks;
  });
}

// Minimal OMP RPC server used to exercise startRpcSession end-to-end without
// touching a real `omp` binary or model. Declares protocol v1 only so the
// client skips chunk negotiation.
const FAKE_OMP_SCRIPT = `#!/usr/bin/env node
import { createInterface } from "readline";
import { appendFileSync } from "fs";

const logPath = process.env.FAKE_OMP_LOG;
function log(line) {
  if (logPath) appendFileSync(logPath, line + "\\n");
}

process.stdout.write(
  JSON.stringify({
    type: "ready",
    protocolVersion: 1,
    supportedProtocolVersions: [1],
    maxFrameBytes: 1048576,
    maxReassembledFrameBytes: 0,
  }) + "\\n",
);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  log(line);
  let cmd;
  try { cmd = JSON.parse(line); } catch { return; }
  let data = {};
  if (cmd.type === "get_state") {
    data = {
      sessionId: "real-session-1",
      sessionFile: "/tmp/real-session.jsonl",
      isStreaming: false,
      isCompacting: false,
      autoCompactionEnabled: true,
      messageCount: 0,
      thinkingLevel: "off",
    };
  } else if (cmd.type === "set_model") {
    data = { model: { provider: cmd.provider, id: cmd.modelId } };
  } else if (cmd.type === "new_session") {
    data = { sessionId: "forked-session", sessionFile: "/tmp/forked.jsonl" };
  }
  process.stdout.write(
    JSON.stringify({
      type: "response",
      command: cmd.type,
      success: true,
      data,
      id: cmd.id,
    }) + "\\n",
  );
});

process.stdin.on("end", () => process.exit(0));
`;

function setupFakeOmp(t) {
  const dir = mkdtempSync(join(tmpdir(), "omp-rpc-"));
  const scriptPath = join(dir, "fake-omp.mjs");
  const logPath = join(dir, "commands.log");
  writeFileSync(scriptPath, FAKE_OMP_SCRIPT);
  chmodSync(scriptPath, 0o755);
  const previousOmpBinary = process.env.OMP_BINARY;
  const previousLog = process.env.FAKE_OMP_LOG;
  process.env.OMP_BINARY = scriptPath;
  process.env.FAKE_OMP_LOG = logPath;
  t.after(() => {
    process.env.OMP_BINARY = previousOmpBinary;
    process.env.FAKE_OMP_LOG = previousLog;
    rmSync(dir, { recursive: true, force: true });
  });
  return logPath;
}

function readCommandLog(logPath) {
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// startRpcSession (end-to-end via a fake OMP RPC server)
// ---------------------------------------------------------------------------

test("startRpcSession opens a new session via get_state and applies initial model + thinking level", async (t) => {
  resetRegistry(t);
  const logPath = setupFakeOmp(t);

  const { session, realSessionId } = await startRpcSession(
    "req-session",
    "",
    process.cwd(),
    {
      initialModel: { provider: "anthropic", modelId: "claude" },
      thinkingLevel: "high",
    },
  );

  assert.equal(realSessionId, "real-session-1");
  assert.equal(session.sessionId, "real-session-1");
  assert.equal(session.sessionFile, "/tmp/real-session.jsonl");
  assert.equal(getRpcSession("real-session-1"), session);

  await session.shutdown();

  const commands = readCommandLog(logPath);
  // The first three commands are awaited before the wrapper starts, so their
  // order is deterministic; the async initial state sync may append a later
  // get_state after them.
  assert.deepEqual(
    commands.slice(0, 3).map((c) => c.type),
    ["get_state", "set_model", "set_thinking_level"],
  );
  const setModel = commands.find((c) => c.type === "set_model");
  assert.deepEqual(
    { provider: setModel.provider, modelId: setModel.modelId },
    { provider: "anthropic", modelId: "claude" },
  );
  const setThinking = commands.find((c) => c.type === "set_thinking_level");
  assert.equal(setThinking.level, "high");
});

test("startRpcSession switches to an existing session file and trusts its cwd", async (t) => {
  resetRegistry(t);
  const logPath = setupFakeOmp(t);

  const { session, realSessionId } = await startRpcSession(
    "req-session",
    "/existing/session.jsonl",
    process.cwd(),
  );

  assert.equal(realSessionId, "req-session");
  assert.equal(session.sessionId, "req-session");
  assert.equal(session.sessionFile, "/existing/session.jsonl");

  await session.shutdown();

  const commands = readCommandLog(logPath);
  assert.equal(commands[0].type, "switch_session");
  assert.equal(commands[0].sessionPath, "/existing/session.jsonl");
});

// ---------------------------------------------------------------------------
// OmpSessionWrapper behavior (mock client)
// ---------------------------------------------------------------------------

test("prompt rejects while a shell command is running", async () => {
  const client = makeMockClient();
  let resolveBash;
  client.sendCommand = async (command) => {
    if (command.type === "bash") {
      return new Promise((resolve) => {
        resolveBash = resolve;
      });
    }
    return undefined;
  };

  const wrapper = new OmpSessionWrapper(client, {
    sessionId: "s1",
    sessionFile: "",
    cwd: "/tmp",
  });

  const bashPromise = wrapper.send({ type: "bash", command: "ls" });
  await assert.rejects(
    () => wrapper.send({ type: "prompt", message: "hi" }),
    /shell command is running/,
  );
  resolveBash({});
  await bashPromise;
  wrapper.destroy();
});

test("fork requires an entryId and rejects entry-scoped forks as unsupported", async () => {
  const client = makeMockClient();
  const wrapper = new OmpSessionWrapper(client, {
    sessionId: "s1",
    sessionFile: "/parent.jsonl",
    cwd: "/tmp",
  });

  await assert.rejects(
    () => wrapper.send({ type: "fork" }),
    /entryId is required/,
  );

  await assert.rejects(
    () => wrapper.send({ type: "fork", entryId: "e1" }),
    (error) => {
      assert.equal(error.code, "capability_unavailable");
      assert.equal(error.feature, "fork_at_entry");
      return true;
    },
  );

  // The explicit failure must not tear down the live wrapper.
  assert.equal(wrapper.isAlive(), true);
  wrapper.destroy();
});

test("set_tools reports it is not supported in OMP RPC mode", async () => {
  const client = makeMockClient();
  const wrapper = new OmpSessionWrapper(client, {
    sessionId: "s1",
    sessionFile: "",
    cwd: "/tmp",
  });

  await assert.rejects(
    () => wrapper.send({ type: "set_tools", toolNames: [] }),
    /Tool filtering is not supported/,
  );
  wrapper.destroy();
});

test("get_state maps OMP state to the pi-web shape", async () => {
  const client = makeMockClient();
  client.sendCommand = async (command) => {
    if (command.type === "get_state") {
      return {
        sessionId: "s1",
        sessionFile: "/s.jsonl",
        isStreaming: true,
        isCompacting: false,
        autoCompactionEnabled: true,
        messageCount: 3,
        thinkingLevel: "high",
        model: { provider: "anthropic", id: "claude" },
        contextUsage: { tokens: 100, contextWindow: 200000, percent: 0.05 },
        systemPrompt: ["line1", "line2"],
      };
    }
    return undefined;
  };

  const wrapper = new OmpSessionWrapper(client, {
    sessionId: "s1",
    sessionFile: "/s.jsonl",
    cwd: "/tmp",
  });

  const state = await wrapper.send({ type: "get_state" });

  assert.equal(state.isStreaming, true);
  assert.deepEqual(state.model, { id: "claude", provider: "anthropic" });
  assert.equal(state.systemPrompt, "line1\nline2");
  assert.equal(state.thinkingLevel, "high");
  assert.equal(state.messageCount, 3);
  wrapper.destroy();
});

test("agent_end clears streaming and emits prompt_done", () => {
  const client = makeMockClient();
  const wrapper = new OmpSessionWrapper(client, {
    sessionId: "s1",
    sessionFile: "",
    cwd: "/tmp",
  });

  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();

  client.emit({ type: "agent_start" });
  assert.equal(wrapper.isStreaming, true);

  client.emit({ type: "agent_end" });
  assert.equal(wrapper.isStreaming, false);
  assert.ok(events.some((event) => event.type === "prompt_done"));
  wrapper.destroy();
});

test("prompt with agentInvoked false acknowledges with prompt_done", async () => {
  const client = makeMockClient();
  client.send = async (command) => ({
    type: "response",
    command: command.type,
    success: true,
    data: { agentInvoked: false },
  });

  const wrapper = new OmpSessionWrapper(client, {
    sessionId: "s1",
    sessionFile: "",
    cwd: "/tmp",
  });

  const events = [];
  wrapper.onEvent((event) => events.push(event));

  await wrapper.send({ type: "prompt", message: "hi" });

  assert.ok(events.some((event) => event.type === "prompt_done"));
  wrapper.destroy();
});
