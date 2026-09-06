import { NextResponse } from "next/server";
import {
  readPinnedProjects,
  readClosedProjects,
  readProjectOrder,
  writePinnedProjects,
  writeClosedProjects,
  writeProjectOrder,
  upsertPinnedProject,
  removePinnedProject,
  type PinnedProject,
} from "@/lib/pinned-projects";
import { projectIdentityKey } from "@/lib/project-identity";

interface PinBody { action: "pin"; key: string; root: string; }
interface UnpinBody { action: "unpin"; key: string; }
interface ReplaceBody { action: "replace"; projects: PinnedProject[]; }
interface CloseBody { action: "close" | "reopen"; key: string; }
interface ReorderBody { action: "reorder"; order: string[]; }
type Body = PinBody | UnpinBody | ReplaceBody | CloseBody | ReorderBody;

// Older builds pinned projects under the raw cwd as key, which on Windows
// differs from the server's canonical projectKey (case-folded, normalized
// separators) and made the same project appear twice in the sidebar.
// Canonicalize every stored key and merge duplicates that resolve to one path.
function canonicalizeProjects(projects: PinnedProject[]): PinnedProject[] {
  const byKey = new Map<string, PinnedProject>();
  for (const p of projects) {
    const key = projectIdentityKey(p.root);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...p, key });
      continue;
    }
    // Prefer the root of the entry that already carried the canonical key,
    // and keep the most recent lastOpenedAt.
    byKey.set(key, {
      key,
      root: existing.key === key ? existing.root : p.root,
      lastOpenedAt: existing.lastOpenedAt > p.lastOpenedAt ? existing.lastOpenedAt : p.lastOpenedAt,
    });
  }
  return [...byKey.values()];
}

function canonicalizeKeyList(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const canonical = projectIdentityKey(k);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

export async function GET(): Promise<NextResponse> {
  const [projects, closedProjects, projectOrder] = await Promise.all([
    readPinnedProjects(),
    readClosedProjects(),
    readProjectOrder(),
  ]);
  const nextProjects = canonicalizeProjects(projects);
  const nextClosed = canonicalizeKeyList(closedProjects);
  const nextOrder = canonicalizeKeyList(projectOrder);
  // Self-heal: persist the canonicalized form so the fixup happens once, not
  // on every read.
  if (JSON.stringify(nextProjects) !== JSON.stringify(projects)) {
    await writePinnedProjects(nextProjects);
  }
  if (JSON.stringify(nextClosed) !== JSON.stringify(closedProjects)) {
    await writeClosedProjects(nextClosed);
  }
  if (JSON.stringify(nextOrder) !== JSON.stringify(projectOrder)) {
    await writeProjectOrder(nextOrder);
  }
  return NextResponse.json({ projects: nextProjects, closedProjects: nextClosed, projectOrder: nextOrder });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const current = await readPinnedProjects();

  if (body.action === "pin") {
    if (typeof body.key !== "string" || typeof body.root !== "string") {
      return NextResponse.json({ error: "key and root are required" }, { status: 400 });
    }
    // Derive the key from the root so a client that pinned under a raw
    // (non-canonical) cwd cannot reintroduce a duplicate entry.
    const next = upsertPinnedProject(canonicalizeProjects(current), projectIdentityKey(body.root), body.root);
    await writePinnedProjects(next);
    return NextResponse.json({ projects: next });
  }

  if (body.action === "unpin") {
    if (typeof body.key !== "string") {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }
    const next = removePinnedProject(current, body.key);
    await writePinnedProjects(next);
    return NextResponse.json({ projects: next });
  }

  if (body.action === "replace") {
    if (!Array.isArray(body.projects)
      || !body.projects.every((p) => p !== null && typeof p === "object"
        && typeof p.key === "string"
        && typeof p.root === "string"
        && typeof p.lastOpenedAt === "string")) {
      return NextResponse.json({ error: "projects must be an array of {key, root, lastOpenedAt} strings" }, { status: 400 });
    }
    await writePinnedProjects(body.projects);
    return NextResponse.json({ projects: body.projects });
  }

  if (body.action === "close" || body.action === "reopen") {
    if (typeof body.key !== "string") {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }
    const closed = new Set(await readClosedProjects());
    if (body.action === "close") closed.add(body.key);
    else closed.delete(body.key);
    const next = [...closed];
    await writeClosedProjects(next);
    return NextResponse.json({ closedProjects: next });
  }

  if (body.action === "reorder") {
    if (!Array.isArray(body.order) || body.order.some((k) => typeof k !== "string")) {
      return NextResponse.json({ error: "order must be an array of keys" }, { status: 400 });
    }
    await writeProjectOrder(body.order);
    return NextResponse.json({ projectOrder: body.order });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}