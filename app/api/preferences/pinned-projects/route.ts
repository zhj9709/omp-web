import { NextResponse } from "next/server";
import {
  readPinnedProjects,
  upsertPinnedProject,
  removePinnedProject,
  writePinnedProjects,
  type PinnedProject,
} from "@/lib/pinned-projects";

interface PinBody { action: "pin"; key: string; root: string; }
interface UnpinBody { action: "unpin"; key: string; }
interface ReplaceBody { action: "replace"; projects: PinnedProject[]; }
type Body = PinBody | UnpinBody | ReplaceBody;

export async function GET(): Promise<NextResponse> {
  const projects = await readPinnedProjects();
  return NextResponse.json({ projects });
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
    if (!Array.isArray(body.projects)) {
      return NextResponse.json({ error: "projects must be an array" }, { status: 400 });
    }
    await writePinnedProjects(body.projects);
    return NextResponse.json({ projects: body.projects });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}