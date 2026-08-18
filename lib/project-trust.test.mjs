import assert from "node:assert/strict";
import test from "node:test";
import {
  getProjectTrustStatus,
  projectTrustReloadOptions,
  trustProject,
} from "./project-trust.ts";

test("OMP has no trust gate: every project reports trusted", () => {
  assert.deepEqual(getProjectTrustStatus("/any/cwd", "/any/agent"), {
    requiresTrust: false,
    trusted: true,
  });
});

test("trustProject is a no-op that reports trusted", () => {
  assert.deepEqual(trustProject("/any/cwd", "/any/agent"), {
    requiresTrust: false,
    trusted: true,
  });
});

test("project resources always load without a trust-gated reload", () => {
  assert.equal(projectTrustReloadOptions("/any/cwd", "/any/agent"), undefined);
});
