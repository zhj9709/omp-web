import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { OmpSessionWrapper, getRpcSessionInfos } = await jiti.import("./rpc-manager.ts");

function makeMockClient() {
  return {
    onEvent() {
      return () => {};
    },
    async send(command) {
      return { type: "response", command: command.type, success: true, data: undefined };
    },
    async sendCommand() {
      return undefined;
    },
    dispose() {},
  };
}

function makeWrapper({ id, filePath, cwd = "/tmp/runtime-cwd" }) {
  return new OmpSessionWrapper(makeMockClient(), {
    sessionId: id,
    sessionFile: filePath,
    cwd,
  });
}

test("lists a live runtime session as transient before its JSONL file exists", (t) => {
  const previousRegistry = globalThis.__ompSessions;
  const wrapper = makeWrapper({
    id: "visible-runtime",
    filePath: join(tmpdir(), "omp-web-missing-runtime-session.jsonl"),
  });
  globalThis.__ompSessions = new Map([["visible-runtime", wrapper]]);
  t.after(() => {
    globalThis.__ompSessions = previousRegistry;
  });

  const infos = getRpcSessionInfos();

  assert.equal(infos.length, 1);
  assert.equal(infos[0].id, "visible-runtime");
  assert.equal(infos[0].path, wrapper.sessionFile);
  assert.equal(infos[0].cwd, "/tmp/runtime-cwd");
  assert.equal(infos[0].firstMessage, "(live session)");
  assert.equal(infos[0].messageCount, 0);
  assert.equal(infos[0].transient, true);
});

test("keeps a live runtime session non-transient once its JSONL file exists", (t) => {
  const previousRegistry = globalThis.__ompSessions;
  const dir = mkdtempSync(join(tmpdir(), "omp-web-runtime-session-"));
  const filePath = join(dir, "session.jsonl");
  writeFileSync(filePath, "persisted\n");
  const wrapper = makeWrapper({ id: "persisted-runtime", filePath });
  globalThis.__ompSessions = new Map([["persisted-runtime", wrapper]]);
  t.after(() => {
    globalThis.__ompSessions = previousRegistry;
    rmSync(dir, { recursive: true, force: true });
  });

  const infos = getRpcSessionInfos();

  assert.equal(infos.length, 1);
  assert.equal(infos[0].id, "persisted-runtime");
  assert.equal(infos[0].firstMessage, "(live session)");
  assert.equal(infos[0].messageCount, 0);
  assert.equal(infos[0].transient, false);
});

test("excludes a destroyed wrapper from the session list", (t) => {
  const previousRegistry = globalThis.__ompSessions;
  const live = makeWrapper({
    id: "live-runtime",
    filePath: join(tmpdir(), "omp-web-live-runtime-session.jsonl"),
  });
  const dead = makeWrapper({
    id: "dead-runtime",
    filePath: join(tmpdir(), "omp-web-dead-runtime-session.jsonl"),
  });
  dead.destroy();
  globalThis.__ompSessions = new Map([
    ["live-runtime", live],
    ["dead-runtime", dead],
  ]);
  t.after(() => {
    globalThis.__ompSessions = previousRegistry;
  });

  const infos = getRpcSessionInfos();

  assert.equal(infos.length, 1);
  assert.equal(infos[0].id, "live-runtime");
});
