/**
 * Disk-only subagent roster: parses a session .jsonl for `task` tool calls and
 * rebuilds the list of subagents that were spawned in that session.
 *
 * Why this exists: live subagent status (running/progress/idle) only exists in
 * the memory of the OMP process executing the session. The web server cannot
 * see subagents of CLI-driven sessions. What it CAN always do is read the
 * session file — the spawn records are facts on disk. This module powers the
 * roster's historical fallback when the live RPC track has nothing.
 *
 * Shapes handled:
 *   - batch spawn: arguments.tasks = [{ name, agent, effort, task }]
 *   - single spawn: arguments = { task: string, ... } (no tasks array)
 */
import { readFileSync } from "node:fs";
import { isRecord } from "./models-config-writer";
import type { SubagentSpawn } from "./subagents";

export type { SubagentSpawn } from "./subagents";

/** Parse every `task` tool call in the session file into spawn records. */
export function parseSubagentSpawns(sessionFile: string): SubagentSpawn[] {
  let raw: string;
  try {
    raw = readFileSync(sessionFile, "utf8");
  } catch {
    return [];
  }
  const spawns: SubagentSpawn[] = [];
  for (const line of raw.split("\n")) {
    if (!line.includes("\"task\"")) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || !isRecord(entry.message)) continue;
    const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : null;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type !== "toolCall" || block.name !== "task") continue;
      const callId = typeof block.id === "string" ? block.id : "task";
      const args = isRecord(block.arguments) ? block.arguments : {};
      const batch = Array.isArray(args.tasks) ? args.tasks : null;
      if (batch && batch.length > 0) {
        batch.forEach((item, idx) => {
          const rec = isRecord(item) ? item : {};
          spawns.push({
            callId: `${callId}:${idx}`,
            name: typeof rec.name === "string" ? rec.name : null,
            agent: typeof rec.agent === "string" ? rec.agent : null,
            effort: typeof rec.effort === "string" ? rec.effort : null,
            task: typeof rec.task === "string" ? rec.task : "",
            spawnedAt: timestamp,
          });
        });
      } else if (typeof args.task === "string" && args.task.trim()) {
        spawns.push({
          callId,
          name: typeof args.name === "string" ? args.name : null,
          agent: typeof args.agent === "string" ? args.agent : "task",
          effort: typeof args.effort === "string" ? args.effort : null,
          task: args.task,
          spawnedAt: timestamp,
        });
      }
    }
  }
  return spawns;
}
