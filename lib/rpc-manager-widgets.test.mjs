import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { OmpSessionWrapper } = await jiti.import("./rpc-manager.ts");

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

function makeWrapper(client) {
  return new OmpSessionWrapper(client, {
    sessionId: "s1",
    sessionFile: "/tmp/s1.jsonl",
    cwd: "/tmp",
  });
}

test("get_state reports no extension widgets or statuses even when OMP returns them", async () => {
  const client = makeMockClient();
  client.sendCommand = async (command) => {
    if (command.type === "get_state") {
      return {
        sessionId: "s1",
        sessionFile: "/tmp/s1.jsonl",
        isStreaming: false,
        isCompacting: false,
        autoCompactionEnabled: true,
        messageCount: 0,
        thinkingLevel: "off",
        extensionWidgets: [{ id: "w1", component: "FakeWidget" }],
        extensionStatuses: [{ id: "st1", label: "FakeStatus" }],
      };
    }
    return undefined;
  };

  const wrapper = makeWrapper(client);
  const state = await wrapper.send({ type: "get_state" });

  assert.deepEqual(state.extensionWidgets, []);
  assert.deepEqual(state.extensionStatuses, []);
  wrapper.destroy();
});

test("get_state always returns empty widget arrays with no pi extension widgets", async () => {
  const client = makeMockClient();
  client.sendCommand = async (command) => {
    if (command.type === "get_state") {
      return { sessionId: "s1", sessionFile: "/tmp/s1.jsonl" };
    }
    return undefined;
  };

  const wrapper = makeWrapper(client);
  const state = await wrapper.send({ type: "get_state" });

  assert.deepEqual(state.extensionWidgets, []);
  assert.deepEqual(state.extensionStatuses, []);
  wrapper.destroy();
});

test("extension_ui_response forwards its payload to the OMP RPC client", async () => {
  const client = makeMockClient();
  const wrapper = makeWrapper(client);

  await wrapper.send({
    type: "extension_ui_response",
    widgetId: "w1",
    payload: { value: 42 },
  });

  assert.ok(
    client.sent.some(
      (command) =>
        command.type === "extension_ui_response" &&
        command.widgetId === "w1" &&
        command.payload.value === 42,
    ),
  );
  wrapper.destroy();
});
