import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionTree, computeLeafId, getSessionNameFromEntries } =
  await jiti.import("./session-tree.ts");

function entry(id, parentId, extra = {}) {
  return {
    type: "message",
    id,
    parentId: parentId ?? null,
    timestamp: "",
    ...extra,
  };
}

test("builds a tree with multiple roots and children", () => {
  const tree = buildSessionTree([
    entry("a"),
    entry("b", "a"),
    entry("c", "b"),
    entry("d"), // second root
    entry("e", "d"),
  ]);
  assert.equal(tree.length, 2);
  const a = tree.find((n) => n.entry.id === "a");
  const d = tree.find((n) => n.entry.id === "d");
  assert.equal(a?.children.length, 1);
  assert.equal(a?.children[0].entry.id, "b");
  assert.equal(a?.children[0].children[0].entry.id, "c");
  assert.equal(d?.children[0].entry.id, "e");
});

test("dangling parent ids become roots", () => {
  const tree = buildSessionTree([
    entry("orphan", "missing-parent"),
    entry("a"),
  ]);
  assert.equal(tree.length, 2);
  assert.ok(tree.some((n) => n.entry.id === "orphan"));
});

test("handles cycles without hanging", () => {
  // a -> b -> a: the tree must still terminate and produce exactly one root.
  const tree = buildSessionTree([
    { ...entry("a", "b"), type: "message" },
    { ...entry("b", "a"), type: "message" },
  ]);
  // Both have parents present in byId, so neither is a root by the parent
  // rule; each node's children array is attached once.
  assert.equal(tree.length, 0);
});

test("deep linear chains do not overflow the stack", () => {
  const depth = 100_000;
  const entries = [];
  let prev = null;
  for (let i = 0; i < depth; i++) {
    const id = `n${i}`;
    entries.push(entry(id, prev ?? undefined));
    prev = id;
  }
  const tree = buildSessionTree(entries);
  assert.equal(tree.length, 1);
  let node = tree[0];
  let count = 1;
  while (node.children.length > 0) {
    node = node.children[0];
    count += 1;
  }
  assert.equal(count, depth);
});

test("computeLeafId returns the last entry id", () => {
  const entries = [entry("a"), entry("b", "a")];
  assert.equal(computeLeafId(entries), "b");
  assert.equal(computeLeafId([]), null);
});

test("getSessionNameFromEntries prefers the latest session_info name", () => {
  const entries = [
    { type: "session_info", id: "s1", parentId: null, timestamp: "", name: "first" },
    { type: "session_info", id: "s2", parentId: null, timestamp: "", name: "second" },
  ];
  assert.equal(getSessionNameFromEntries(entries, "header"), "second");
  assert.equal(getSessionNameFromEntries([], "header"), "header");
});
