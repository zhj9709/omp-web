import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./project-identity.ts");
}

test("Windows project identity ignores full-path casing and separator style", async () => {
  const { projectIdentityKey } = await loadSubject();

  const expected = projectIdentityKey("C:\\Users\\Alex\\Project\\Study\\ELM", "win32");
  assert.equal(projectIdentityKey("c:/users/ALEX/project/study/elm", "win32"), expected);
  assert.equal(projectIdentityKey("c:\\Users\\Alex\\Project\\Study\\.\\ELM\\", "win32"), expected);
});

test("Windows project identity handles UNC casing and separators", async () => {
  const { projectIdentityKey } = await loadSubject();

  assert.equal(
    projectIdentityKey("\\\\Server\\Share\\Team\\Agent", "win32"),
    projectIdentityKey("//server/share/team/AGENT/", "win32"),
  );
});

test("project identity preserves case on case-sensitive platforms", async () => {
  const { projectIdentityKey } = await loadSubject();

  assert.notEqual(
    projectIdentityKey("/Users/Alex/Project", "linux"),
    projectIdentityKey("/users/alex/project", "linux"),
  );
  assert.notEqual(
    projectIdentityKey("/a\\b", "linux"),
    projectIdentityKey("/a/b", "linux"),
  );
});

// The new-session flow computes the key in the browser, where process.platform
// is a polyfill (here emulated as "browser") and the win32/posix decision must
// come from the path's shape alone. Server and browser must agree for every
// platform value.
test("project identity shape-detects Windows paths on any platform", async () => {
  const { projectIdentityKey } = await loadSubject();

  const expected = projectIdentityKey("D:\\Projects\\AI", "win32");
  assert.equal(projectIdentityKey("D:\\Projects\\AI"), expected);
  assert.equal(projectIdentityKey("D:\\Projects\\AI", "linux"), expected);
  assert.equal(projectIdentityKey("D:\\Projects\\AI", "browser"), expected);
  assert.equal(projectIdentityKey("d:/projects/ai/", "browser"), expected);
});

test("project identity keeps POSIX rules on non-Windows platforms", async () => {
  const { projectIdentityKey } = await loadSubject();

  const expected = projectIdentityKey("/home/alex/project", "linux");
  assert.equal(projectIdentityKey("/home/alex/project", "linux"), expected);
  assert.equal(projectIdentityKey("/home/alex/project/", "browser"), expected);
  // A lone leading backslash is not a UNC prefix.
  assert.equal(projectIdentityKey("\\home\\alex\\project", "win32"), projectIdentityKey("/home/alex/project", "win32"));
});

// Older builds pinned projects under the raw cwd while the server keyed them
// canonically; both must collapse to the same identity.
test("raw cwd keys and canonical server keys share one identity", async () => {
  const { projectIdentityKey } = await loadSubject();

  const canonical = projectIdentityKey("D:\\Users\\VertexZzz\\Desktop\\github\\OpenCodeUI", "win32");
  assert.equal(projectIdentityKey("d:\\users\\vertexzzz\\desktop\\github\\opencodeui", "win32"), canonical);
  assert.equal(projectIdentityKey("D:/Users/VertexZzz/Desktop/github/OpenCodeUI/", "win32"), canonical);
  assert.notEqual(canonical, "");
});
