/**
 * TUI-only builtin slash commands that OMP RPC does not advertise (no
 * text-mode handler). The web UI merges this catalog into the palette so the
 * command list matches the TUI; each entry resolves to either a local web
 * action (see handleBuiltinSlashCommand) or an explicit "TUI-only" message.
 * Descriptions mirror packages/coding-agent/src/slash-commands/*.ts.
 */
export interface CatalogSlashCommand {
  name: string;
  description: string;
  source?: "builtin";
}

export const TUI_ONLY_COMMAND_CATALOG: CatalogSlashCommand[] = [
  { name: "settings", description: "Open settings menu" },
  { name: "setup", description: "Open provider setup" },
  { name: "plan", description: "Toggle plan mode (agent plans before executing)" },
  { name: "plan-review", description: "Re-open the plan review for the latest plan" },
  { name: "vibe", description: "Toggle vibe mode (persistent fast worker sessions)" },
  { name: "goal", description: "Toggle goal mode (persistent autonomous objective)" },
  { name: "guided-goal", description: "Have the agent interview you, then set up goal mode" },
  { name: "loop", description: "Loop on a task" },
  { name: "queue", description: "Queue a message for after the agent yields" },
  { name: "switch", description: "Switch model for this session" },
  { name: "collab", description: "Share this session live via a relay" },
  { name: "join", description: "Join a shared collab session" },
  { name: "leave", description: "Leave the collab session" },
  { name: "hotkeys", description: "Show all keyboard shortcuts" },
  { name: "extensions", description: "Open Extension Control Center dashboard" },
  { name: "agents", description: "Open the agents hub (per-agent model, prewalk, advisor)" },
  { name: "branch", description: "Create a new branch from a previous message" },
  { name: "fork", description: "Create a new fork from a previous message" },
  { name: "tree", description: "Navigate session tree (switch branches)" },
  { name: "login", description: "Login with OAuth provider" },
  { name: "logout", description: "Logout from OAuth provider" },
  { name: "new", description: "Start a new session" },
  { name: "clear", description: "Clear the conversation context in place" },
  { name: "drop", description: "Delete the current session" },
  { name: "handoff", description: "Hand off session context to a new session" },
  { name: "resume", description: "Resume a different session" },
  { name: "btw", description: "Ask an ephemeral side question" },
  { name: "tan", description: "Run a full background agent on tangential work" },
  { name: "omfg", description: "Forge a TTSR rule from a complaint" },
  { name: "retry", description: "Retry the last failed agent turn" },
  { name: "debug", description: "Open debug tools selector" },
  { name: "exit", description: "Exit the application" },
  { name: "live", description: "Start realtime voice mode" },
  { name: "pause", description: "Freeze all agents until resumed" },
  { name: "quit", description: "Quit the application" },
];

/** Command source values shared with the chat palette. */
export type SlashCommandSource = "extension" | "prompt" | "skill" | "builtin" | "custom" | "file" | "mcp_prompt";

/** Merge the catalog into RPC-advertised commands, deduplicated by name. */
export function mergeTuiOnlyCommands(
  commands: ReadonlyArray<{ name: string; source: string; description?: string }>,
): Array<{ name: string; description?: string; source: SlashCommandSource }> {
  const byName = new Map(commands.map((c) => [c.name, c]));
  const merged: Array<{ name: string; description?: string; source: SlashCommandSource }> =
    commands.map((c) => ({ name: c.name, description: c.description, source: c.source as SlashCommandSource }));
  for (const catalog of TUI_ONLY_COMMAND_CATALOG) {
    if (byName.has(catalog.name)) continue;
    merged.push({ ...catalog, source: "builtin" });
  }
  return merged;
}
