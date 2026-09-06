const MAX_PROGRESS_LENGTH = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getToolExecutionProgress(partialResult: unknown): string | null {
  if (!isObject(partialResult)) return null;

  const content = partialResult.content;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter((block) => isObject(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  const lines = text.split(/\r?\n/);
  let latest = "";
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    latest = lines[index].trim();
    if (latest) break;
  }
  if (!latest) return null;

  const normalized = latest.replace(/\s+/g, " ");
  return normalized.length <= MAX_PROGRESS_LENGTH
    ? normalized
    : `...${normalized.slice(-(MAX_PROGRESS_LENGTH - 3))}`;
}

/**
 * Short human-readable digest of a tool call's arguments for the activity
 * line: the path / pattern / query / url / command the tool is working on
 * (TUI status lines show the object of the action, not just its name).
 * Returns null when nothing recognizable is present.
 */
export function toolArgsDigest(args: Record<string, unknown>): string | null {
  const keys = ["path", "file_path", "filePath", "pattern", "query", "url", "command", "name"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      const short = value.length > 60 ? value.slice(0, 57) + "…" : value;
      return short;
    }
  }
  return null;
}

/** Pull the concrete shell command out of a toolcall's arguments payload. */
export function extractToolCommand(argumentsValue: unknown): string | null {
  if (typeof argumentsValue === "string") {
    try {
      const parsed = JSON.parse(argumentsValue) as unknown;
      if (parsed && typeof parsed === "object") {
        const cmd = (parsed as Record<string, unknown>).command;
        if (typeof cmd === "string" && cmd.trim()) return cmd;
      }
    } catch {
      // Not JSON — not a command payload.
    }
    return null;
  }
  if (argumentsValue && typeof argumentsValue === "object") {
    const cmd = (argumentsValue as Record<string, unknown>).command;
    if (typeof cmd === "string" && cmd.trim()) return cmd;
  }
  return null;
}
