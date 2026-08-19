import { NextResponse } from "next/server";
import { collectUsageStats } from "@/lib/usage-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = collectUsageStats();
    return NextResponse.json(stats, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}