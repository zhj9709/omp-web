import { NextResponse } from "next/server";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { allowFileRoot } from "@/lib/file-access";
import { invalidateSessionListCache } from "@/lib/session-reader";
import { startRpcSession } from "@/lib/rpc-manager";
import { isRestrictiveToolRequest } from "@/lib/tool-presets";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel)) {
    return value as ThinkingLevel;
  }
  throw new Error(`Invalid thinking level: ${String(value)}`);
}

type SteeringMode = "all" | "one-at-a-time";
type FollowUpMode = "all" | "one-at-a-time";
type InterruptMode = "immediate" | "wait";

const STEERING_MODES: Record<string, true> = { all: true, "one-at-a-time": true };
const FOLLOW_UP_MODES: Record<string, true> = { all: true, "one-at-a-time": true };
const INTERRUPT_MODES: Record<string, true> = { immediate: true, wait: true };

function parseQueueMode<T extends string>(
  value: unknown,
  allowed: Record<string, true>,
  name: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && allowed[value]) return value as T;
  throw new Error(`Invalid ${name}: ${String(value)}`);
}
// POST /api/agent/new  body: { cwd: string; type: string; message?: string; ... }
// Spawns a brand-new pi session. Most calls immediately send the first command;
// type:"ensure_session" only creates the runtime so clients can query commands.
// Returns pi's real session id plus the model/thinking state selected at startup.
export async function POST(req: Request) {
  let commandType: string | undefined;
  let promptAccepted = false;
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;
    commandType = typeof command.type === "string" ? command.type : undefined;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({
        error: "cwd is required",
        ...(commandType === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({
        error: `Directory does not exist: ${cwd}`,
        ...(commandType === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 400 });
    }

    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids
    const { provider, modelId, toolNames, thinkingLevel, steeringMode, followUpMode, interruptMode, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: unknown; steeringMode?: unknown; followUpMode?: unknown; interruptMode?: unknown; [key: string]: unknown };
    if ((provider && !modelId) || (!provider && modelId)) {
      throw new Error("provider and modelId must be provided together");
    }
    const explicitThinkingLevel = parseThinkingLevel(thinkingLevel);
    const explicitSteeringMode = parseQueueMode<SteeringMode>(steeringMode, STEERING_MODES, "steering mode");
    const explicitFollowUpMode = parseQueueMode<FollowUpMode>(followUpMode, FOLLOW_UP_MODES, "follow-up mode");
    const explicitInterruptMode = parseQueueMode<InterruptMode>(interruptMode, INTERRUPT_MODES, "interrupt mode");
    // OMP RPC has no per-session tool filter, so a restrictive tool request
    // (e.g. read-only or none) cannot be honored. Surface it explicitly so the
    // UI can revert the preset instead of silently running with full tools.
    const toolWarnings = toolNames !== undefined && isRestrictiveToolRequest(toolNames)
      ? [{
          code: "capability_unavailable",
          feature: "tool_filtering",
          message: "Tool filtering is not supported in OMP RPC mode.",
        }]
      : undefined;

    // Must be unique per request: startRpcSession coalesces concurrent callers
    // that share a key onto one session. Date.now() (ms resolution) collides for
    // requests in the same millisecond, merging two new sessions into one.
    const tempKey = `__new__${randomUUID()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, {
      ...(provider && modelId ? { initialModel: { provider, modelId } } : {}),
      ...(explicitThinkingLevel ? { thinkingLevel: explicitThinkingLevel } : {}),
      ...(explicitSteeringMode ? { steeringMode: explicitSteeringMode } : {}),
      ...(explicitFollowUpMode ? { followUpMode: explicitFollowUpMode } : {}),
      ...(explicitInterruptMode ? { interruptMode: explicitInterruptMode } : {}),
    });

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    allowFileRoot(cwd);
    invalidateSessionListCache();

    const state = await session.send({ type: "get_state" }) as {
      model?: { id: string; provider: string };
      thinkingLevel?: string;
      steeringMode?: string;
      followUpMode?: string;
      interruptMode?: string;
    };

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({
        success: true,
        sessionId: realSessionId,
        data: null,
        model: state.model
          ? { provider: state.model.provider, modelId: state.model.id }
          : null,
        thinkingLevel: state.thinkingLevel,
        steeringMode: state.steeringMode,
        followUpMode: state.followUpMode,
        interruptMode: state.interruptMode,
        warnings: toolWarnings,
      });
    }

    const result = await session.send(promptCommand);
    promptAccepted = promptCommand.type === "prompt";

    return NextResponse.json({
      success: true,
      sessionId: realSessionId,
      data: result,
      model: state.model
        ? { provider: state.model.provider, modelId: state.model.id }
        : null,
      thinkingLevel: state.thinkingLevel,
      steeringMode: state.steeringMode,
      followUpMode: state.followUpMode,
      interruptMode: state.interruptMode,
      warnings: toolWarnings,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(commandType === "prompt" && !promptAccepted
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: 500 });
  }
}
