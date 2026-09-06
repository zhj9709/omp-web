/**
 * Stable, internal identity for a project path.
 *
 * Keep the original cwd/projectRoot for display and filesystem operations.
 * This key is only for grouping and equality: Windows paths are normalized
 * with win32 rules and case-folded because the default Windows filesystem is
 * case-insensitive. The explicit platform argument keeps those semantics
 * testable on non-Windows CI.
 *
 * Implemented with pure string ops instead of node:path so the same identity
 * can be computed in the browser: client-built transient sessions must carry
 * the exact key the server would derive for them, or the sidebar groups and
 * pins them under a second, duplicate project.
 */
export function projectIdentityKey(
  projectRoot: string,
  platform: NodeJS.Platform = (typeof process !== "undefined" && process.platform) || "linux",
): string {
  if (!projectRoot) return projectRoot;
  // A drive letter or leading \\ is unambiguously Windows, regardless of the
  // host platform — this also lets the browser compute the same key.
  const isWin =
    platform === "win32"
    || /^[A-Za-z]:[\\/]/.test(projectRoot)
    || projectRoot.startsWith("\\\\");

  if (isWin) {
    const p = projectRoot.replace(/[\\/]+/g, "\\");
    // UNC roots start with exactly two leading backslashes (the replace above
    // collapses runs, so any surviving double backslash is a real UNC prefix).
    const uncMatch = /^\\\\[^\\]+\\[^\\]+/.exec(p);
    const driveMatch = /^[A-Za-z]:\\/.exec(p);
    const rootLength = uncMatch
      ? uncMatch[0].length
      : driveMatch
        ? driveMatch[0].length
        : 0;
    let end = p.length;
    while (end > rootLength && p[end - 1] === "\\") end--;
    const root = p.slice(0, rootLength);
    const body = p.slice(rootLength, end);
    const segments: string[] = [];
    for (const seg of body.split("\\")) {
      if (seg === "" || seg === ".") continue;
      if (seg === ".." && segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
        continue;
      }
      segments.push(seg);
    }
    return (root + segments.join("\\")).toLowerCase();
  }

  const rooted = projectRoot.startsWith("/");
  const rootLength = rooted ? 1 : 0;
  let end = projectRoot.length;
  while (end > rootLength && projectRoot[end - 1] === "/") end--;
  const segments: string[] = [];
  for (const seg of projectRoot.slice(rootLength, end).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && segments.length > 0 && segments[segments.length - 1] !== "..") {
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  return (rooted ? "/" : "") + segments.join("/");
}
