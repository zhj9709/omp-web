import { NextResponse } from "next/server";
import { readAllMemories } from "@/lib/memory-service";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ groups: readAllMemories() });
}