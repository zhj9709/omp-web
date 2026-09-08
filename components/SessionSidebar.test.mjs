import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) \{[\s\S]*?return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("manual and lifecycle refreshes bypass the server session-list cache", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.match(source, /onClick=\{\(\) => loadSessions\(false, true\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{hovered && !session\.transient && \(/);
});

test("locate current session expands its project, then scrolls to and flashes the row", () => {
  const locateSource = source.slice(
    source.indexOf("const locateCurrentSession = useCallback"),
    source.indexOf("// Clear the locate fill"),
  );
  const scrollSource = source.slice(
    source.indexOf("// Scroll the located row into view."),
    source.indexOf("const commitCustomPath = useCallback"),
  );

  // A live search or a closed project would keep the row out of the DOM.
  assert.match(locateSource, /if \(searchQuery\) setSearchQuery\(""\);/);
  assert.match(locateSource, /if \(closedProjects\.has\(key\)\) reopenProject\(key\);/);
  // Large groups reach "all" only when the target root is past the first five.
  assert.match(locateSource, /setGroupState\(key, rootIndex >= 0 && rootIndex < 5 \? "five" : "all"\)/);
  assert.match(locateSource, /setExpandState\(\(prev\) => \(\{ \.\.\.prev, \[key\]: \{ hidden: false \} \}\)\)/);
  assert.match(locateSource, /setLocateToken\(\(token\) => token \+ 1\)/);
  // Scroll runs after the expansion commit and falls back to the group header.
  assert.match(scrollSource, /requestAnimationFrame\(run\)/);
  assert.match(scrollSource, /\[data-session-id=/);
  assert.match(scrollSource, /\[data-project-key=/);
  // Highlight is transient: a timer drops the id that drives the ring.
  assert.match(source, /setTimeout\(\(\) => setLocatedSessionId\(null\), 1600\)/);
  // Anchors the imperative scroll and the queried rows actually exist.
  assert.match(source, /ref=\{sessionAreaRef\}/);
  assert.match(sessionItemSource, /data-session-id=\{session\.id\}/);
  assert.match(source, /data-project-key=\{group\.key\}/);
  // The locator sits to the left of search in the toolbar row.
  const toolbar = source.slice(
    source.indexOf("className={styles.toolbar}"),
    source.indexOf("{viewMenuOpen &&"),
  );
  assert.ok(
    toolbar.indexOf('aria-label={t("sidebar.locateSession")}')
      < toolbar.indexOf('aria-label={t("sidebar.searchSessions")}'),
  );
  // The open search box takes over the locator's slot.
  const locateBlock = toolbar.slice(
    toolbar.indexOf("{!searchOpen && ("),
    toolbar.indexOf('aria-label={t("sidebar.searchSessions")}'),
  );
  assert.match(locateBlock, /aria-label=\{t\("sidebar\.locateSession"\)\}/);
});
