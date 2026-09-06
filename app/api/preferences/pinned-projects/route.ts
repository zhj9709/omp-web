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

interface PinBody { action: "pin"; key: string; root: string; }
interface UnpinBody { action: "unpin"; key: string; }
interface ReplaceBody { action: "replace"; projects: PinnedProject[]; }
interface CloseBody { action: "close" | "reopen"; key: string; }
interface ReorderBody { action: "reorder"; order: string[]; }
type Body = PinBody | UnpinBody | ReplaceBody | CloseBody | ReorderBody;

export async function GET(): Promise<NextResponse> {
  const [projects, closedProjects, projectOrder] = await Promise.all([
    readPinnedProjects(),
    readClosedProjects(),
    readProjectOrder(),
  ]);
  return NextResponse.json({ projects, closedProjects, projectOrder });
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
    const next = upsertPinnedProject(current, body.key, body.root);
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