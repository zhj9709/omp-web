import assert from "node:assert/strict";
import test from "node:test";

import {
  addClosedProjectKey,
  loadClosedProjectKeys,
  removeClosedProjectKey,
  saveClosedProjectKeys,
} from "./closed-projects.ts";

function withStorage(run) {
  const backing = new Map();
  const storage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
  };
  globalThis.window = { localStorage: storage };
  try {
    run(backing);
  } finally {
    delete globalThis.window;
  }
}

test("load returns empty without window (SSR)", () => {
  delete globalThis.window;
  assert.deepEqual(loadClosedProjectKeys(), []);
});

test("save then load round-trips keys", () => {
  withStorage((backing) => {
    saveClosedProjectKeys(["a", "b"]);
    assert.deepEqual(loadClosedProjectKeys(), ["a", "b"]);
    assert.equal(backing.get("omp-web.closed-projects"), JSON.stringify(["a", "b"]));
  });
});

test("load tolerates corrupt or non-array payloads", () => {
  withStorage((backing) => {
    backing.set("omp-web.closed-projects", "{not json");
    assert.deepEqual(loadClosedProjectKeys(), []);
    backing.set("omp-web.closed-projects", JSON.stringify({ x: 1 }));
    assert.deepEqual(loadClosedProjectKeys(), []);
    backing.set("omp-web.closed-projects", JSON.stringify(["ok", 3, null]));
    assert.deepEqual(loadClosedProjectKeys(), ["ok"]);
  });
});

test("add adds once and persists; remove deletes and persists", () => {
  withStorage(() => {
    let keys = new Set();
    keys = addClosedProjectKey(keys, "p1");
    keys = addClosedProjectKey(keys, "p1");
    assert.deepEqual([...keys], ["p1"]);
    assert.deepEqual(loadClosedProjectKeys(), ["p1"]);
    keys = removeClosedProjectKey(keys, "p1");
    assert.equal(keys.size, 0);
    assert.deepEqual(loadClosedProjectKeys(), []);
  });
});

test("add/remove return the same set when there is no change", () => {
  withStorage(() => {
    const keys = new Set(["p1"]);
    assert.equal(addClosedProjectKey(keys, "p1"), keys);
    assert.equal(removeClosedProjectKey(keys, "p2"), keys);
  });
});
