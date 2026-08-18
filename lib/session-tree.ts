import type { SessionEntry, SessionTreeNode } from "./types";

/**
 * Build a session tree from flat entries using parentId relationships.
 * Returns top-level (root) nodes.
 */
export function buildSessionTree(entries: SessionEntry[]): SessionTreeNode[] {
  const byId = new Map<string, SessionEntry>();
  const children = new Map<string, SessionTreeNode[]>();

  for (const e of entries) {
    byId.set(e.id, e);
    const pid = e.parentId;
    if (pid) {
      const list = children.get(pid);
      if (list) list.push({ entry: e, children: [] as SessionTreeNode[] });
      else children.set(pid, [{ entry: e, children: [] as SessionTreeNode[] }]);
    }
  }

  // Attach children iteratively (explicit stack) so deep linear sessions
  // cannot overflow the call stack; root nodes have no parent in byId.
  const attach = (root: SessionTreeNode): void => {
    const stack: SessionTreeNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const kids = children.get(node.entry.id);
      if (kids) {
        node.children = kids;
        for (const k of kids) stack.push(k);
      }
    }
  };

  const roots: SessionTreeNode[] = [];
  for (const e of entries) {
    if (!e.parentId || !byId.has(e.parentId)) {
      const node: SessionTreeNode = { entry: e, children: [] };
      attach(node);
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Compute the leaf ID: the last entry in the active chain.
 *
 * OMP appends entries to the session file in chronological order, so the
 * active leaf (the tip of the current branch) is always the last entry.
 * Compaction handling is performed by `walkContextPath` in session-reader.ts,
 * which already follows the leaf's parent chain and drops entries folded into
 * a compaction summary — that logic must not be duplicated here.
 */
export function computeLeafId(entries: SessionEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries[entries.length - 1].id;
}

/**
 * Get the session name from the last session_info entry, falling back to header title.
 */
export function getSessionNameFromEntries(
  entries: SessionEntry[],
  headerTitle: string | undefined,
): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "session_info" && entry.name !== undefined) {
      return entry.name;
    }
  }
  return headerTitle;
}