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
  return {
    disposeCalls: 0,
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
      return { type: "response", command: command.type, success: true, data: undefined };
    },
    async sendCommand() {
      return undefined;
    },
    dispose() {
      this.disposeCalls += 1;
    },
  };
}

function makeWrapper(client) {
  return new OmpSessionWrapper(client, {
    sessionId: "s1",
    sessionFile: "/tmp/s1.jsonl",
    cwd: "/tmp",
  });
}

test("shutdown disposes the OMP RPC client and marks the wrapper dead", async () => {
  const client = makeMockClient();
  const wrapper = makeWrapper(client);

  await wrapper.shutdown();

  assert.equal(client.disposeCalls, 1);
  assert.equal(wrapper.isAlive(), false);
});

test("shutdown is idempotent", async () => {
  const client = makeMockClient();
  const wrapper = makeWrapper(client);

  await wrapper.shutdown();
  await wrapper.shutdown();

  assert.equal(client.disposeCalls, 1);
  assert.equal(wrapper.isAlive(), false);
});

test("shutdown still disposes the client when an onDestroy callback throws", async () => {
  const client = makeMockClient();
  const wrapper = makeWrapper(client);
  wrapper.onDestroy(() => {
    throw new Error("onDestroy boom");
  });

  await assert.rejects(() => wrapper.shutdown(), /onDestroy boom/);

  assert.equal(client.disposeCalls, 1);
  assert.equal(wrapper.isAlive(), false);
});

test("direct destroy marks the wrapper dead without disposing the client", () => {
  const client = makeMockClient();
  const wrapper = makeWrapper(client);

  wrapper.destroy();

  assert.equal(client.disposeCalls, 0);
  assert.equal(wrapper.isAlive(), false);
});

test("onEvent returns an unsubscribe that stops event delivery", () => {
  const client = makeMockClient();
  const wrapper = makeWrapper(client);
  const events = [];
  const unsubscribe = wrapper.onEvent((event) => events.push(event));

  wrapper.start();
  client.emit({ type: "agent_start" });
  assert.equal(events.length, 1);

  unsubscribe();
  client.emit({ type: "agent_end" });
  assert.equal(events.length, 1);

  wrapper.destroy();
});

test("a throwing event listener is isolated from other listeners", () => {
  const client = makeMockClient();
  const wrapper = makeWrapper(client);
  const received = [];
  wrapper.onEvent(() => {
    throw new Error("listener boom");
  });
  wrapper.onEvent((event) => received.push(event.type));

  wrapper.start();
  client.emit({ type: "custom_event" });

  assert.deepEqual(received, ["custom_event"]);
  wrapper.destroy();
});
