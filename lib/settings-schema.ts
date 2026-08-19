/**
 * OMP settings schema — extracted from the OMP binary's settings registry
 * (the same data source the TUI /settings screen renders from).
 * Regenerate: strings $(which omp) → parse the `"key.path": { type, default, ui }` block.
 *
 * Keys are dotted config.yml paths (display.showTokenUsage → display: { showTokenUsage: … }).
 * Entries with `credential: true` are NEVER sent to the client by GET /api/config and are
 * preserved from disk on PUT unless the user types a new value.
 * Entries without `ui` are hidden/advanced settings (no TUI row either).
 */
export type SettingType = "boolean" | "enum" | "number" | "string" | "record" | "array";

export interface SettingOptionMeta { value: string; label?: string; description?: string }

export interface SettingDef {
  key: string;
  type: SettingType;
  default?: unknown;
  values?: string[];
  credential?: boolean;
  description?: string;
  ui?: {
    tab: string;
    group: string;
    label: string;
    description?: string;
    options?: SettingOptionMeta[] | "runtime";
    /** Dotted key of a boolean setting that gates visibility (shown only when truthy). */
    condition?: string;
  };
}

export const SETTINGS_TABS = [
  { id: "appearance", label: "外观", icon: "🎨" },
  { id: "model", label: "模型", icon: "🤖" },
  { id: "interaction", label: "交互", icon: "⌨" },
  { id: "context", label: "上下文", icon: "📋" },
  { id: "memory", label: "记忆", icon: "🧠" },
  { id: "files", label: "文件", icon: "📁" },
  { id: "shell", label: "Shell", icon: "💻" },
  { id: "tools", label: "工具", icon: "🔧" },
  { id: "tasks", label: "任务", icon: "📦" },
  { id: "providers", label: "服务商", icon: "🌐" },
] as const;

export const SETTINGS_SCHEMA: SettingDef[] = [
  {
    "key": "autoResume",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "interaction",
      "group": "Startup & Updates",
      "label": "Auto Resume",
      "description": "Automatically resume the most recent session in the current directory"
    }
  },
  {
    "key": "power.sleepPrevention",
    "type": "enum",
    "values": [
      "off",
      "idle",
      "display",
      "system"
    ],
    "default": "idle",
    "ui": {
      "tab": "interaction",
      "group": "Power (macOS)",
      "label": "Sleep Prevention",
      "description": "Prevent macOS sleep during active sessions. Each level is cumulative — it adds the flags of all lower levels.",
      "options": [
        {
          "value": "off",
          "label": "Off",
          "description": "Do not prevent any sleep"
        },
        {
          "value": "idle",
          "label": "Prevent Idle Sleep",
          "description": "Keep the system awake while a session is open (caffeinate -i)"
        },
        {
          "value": "display",
          "label": "Prevent Display Sleep",
          "description": "Also keep the display from idle-sleeping (caffeinate -i -d)"
        },
        {
          "value": "system",
          "label": "Prevent System Sleep",
          "description": "Also block all system sleep on AC and declare the user active (caffeinate -i -d -s -u)"
        }
      ]
    }
  },
  {
    "key": "advisor.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "model",
      "group": "Advisor",
      "label": "Enable Advisor",
      "description": "Pair a second model (assigned to the 'advisor' role) that passively reviews each turn and injects notes."
    }
  },
  {
    "key": "prewalk.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "model",
      "group": "Prewalk",
      "label": "Enable Prewalk",
      "description": "Start on the active model, then switch to a fast/cheap model (default the 'smol' role) at the first edit/write after the plan nudge's todo list exists — the strong model plans, commits the todos, and starts the implementation before handing off. Overridable per session with --prewalk / --no-prewalk."
    }
  },
  {
    "key": "advisor.syncBacklog",
    "type": "enum",
    "values": [
      "off",
      "1",
      "3",
      "5"
    ],
    "default": "off",
    "ui": {
      "tab": "model",
      "group": "Advisor",
      "label": "Advisor Sync Backlog",
      "description": "Pause the main agent for up to 30 seconds if the advisor falls behind by this many turns. Off disables catch-up delays.",
      "condition": "advisorEnabled"
    }
  },
  {
    "key": "advisor.immuneTurns",
    "type": "number",
    "default": 3,
    "ui": {
      "tab": "model",
      "group": "Advisor",
      "label": "Advisor Immune Turns",
      "description": "After an advisor concern or blocker interrupts, route further concerns/blockers non-interruptingly for this many primary turns.",
      "options": [
        {
          "value": "0",
          "label": "0 turns",
          "description": "Allow every concern/blocker to interrupt."
        },
        {
          "value": "1",
          "label": "1 turn"
        },
        {
          "value": "2",
          "label": "2 turns"
        },
        {
          "value": "3",
          "label": "3 turns",
          "description": "Default."
        },
        {
          "value": "4",
          "label": "4 turns"
        },
        {
          "value": "5",
          "label": "5 turns"
        }
      ],
      "condition": "advisorEnabled"
    }
  },
  {
    "key": "git.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Git",
      "label": "Enable Git Integration",
      "description": "Show git branch, status, and PR information in the TUI and watch repository metadata."
    }
  },
  {
    "key": "providers.maxInFlightRequests",
    "type": "record",
    "default": {},
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Max In-Flight Requests",
      "description": "Maximum concurrent LLM requests per provider id (for example \"openai\" or \"anthropic\"), shared across local OMP processes with this config root. Omitted providers are unlimited."
    }
  },
  {
    "key": "modelRoleStorage",
    "type": "enum",
    "values": [
      "global",
      "project"
    ],
    "default": "global",
    "ui": {
      "tab": "model",
      "group": "Prompt",
      "label": "Model Role Storage",
      "description": "Where model selector role assignments are saved",
      "options": [
        {
          "value": "global",
          "label": "Global",
          "description": "Save role models in the active profile config (current behavior)"
        },
        {
          "value": "project",
          "label": "Per-project",
          "description": "Save project role models in .omp/config.yml; missing project roles use global defaults"
        }
      ]
    }
  },
  {
    "key": "theme.dark",
    "type": "string",
    "default": "titanium",
    "ui": {
      "tab": "appearance",
      "group": "Theme",
      "label": "Dark Theme",
      "description": "Theme used when the terminal has a dark background",
      "options": "runtime"
    }
  },
  {
    "key": "theme.light",
    "type": "string",
    "default": "light",
    "ui": {
      "tab": "appearance",
      "group": "Theme",
      "label": "Light Theme",
      "description": "Theme used when the terminal has a light background",
      "options": "runtime"
    }
  },
  {
    "key": "symbolPreset",
    "type": "enum",
    "values": [
      "unicode",
      "nerd",
      "ascii"
    ],
    "default": "unicode",
    "ui": {
      "tab": "appearance",
      "group": "Theme",
      "label": "Symbol Preset",
      "description": "Glyph set for icons and symbols (Unicode, Nerd Font, or ASCII)",
      "options": [
        {
          "value": "unicode",
          "label": "Unicode",
          "description": "Standard symbols (default)"
        },
        {
          "value": "nerd",
          "label": "Nerd Font",
          "description": "Requires Nerd Font"
        },
        {
          "value": "ascii",
          "label": "ASCII",
          "description": "Maximum compatibility"
        }
      ]
    }
  },
  {
    "key": "colorBlindMode",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Theme",
      "label": "Color-Blind Mode",
      "description": "Use blue instead of green for diff additions"
    }
  },
  {
    "key": "statusLine.preset",
    "type": "enum",
    "values": [
      "default",
      "minimal",
      "compact",
      "full",
      "nerd",
      "ascii",
      "custom"
    ],
    "default": "default",
    "ui": {
      "tab": "appearance",
      "group": "Status Line",
      "label": "Status Line Preset",
      "description": "Pre-built status line configurations",
      "options": [
        {
          "value": "default",
          "label": "Default",
          "description": "Model, path, git, context, tokens, cost"
        },
        {
          "value": "minimal",
          "label": "Minimal",
          "description": "Path and git only"
        },
        {
          "value": "compact",
          "label": "Compact",
          "description": "Model, git, cost, context"
        },
        {
          "value": "full",
          "label": "Full",
          "description": "All segments including time"
        },
        {
          "value": "nerd",
          "label": "Nerd",
          "description": "Maximum info with Nerd Font icons"
        },
        {
          "value": "ascii",
          "label": "ASCII",
          "description": "No special characters"
        },
        {
          "value": "custom",
          "label": "Custom",
          "description": "User-defined segments"
        }
      ]
    }
  },
  {
    "key": "statusLine.separator",
    "type": "enum",
    "values": [
      "powerline",
      "powerline-thin",
      "slash",
      "pipe",
      "block",
      "none",
      "ascii"
    ],
    "default": "powerline-thin",
    "ui": {
      "tab": "appearance",
      "group": "Status Line",
      "label": "Status Line Separator",
      "description": "Style of separators between segments",
      "options": [
        {
          "value": "powerline",
          "label": "Powerline",
          "description": "Solid arrows (Nerd Font)"
        },
        {
          "value": "powerline-thin",
          "label": "Thin chevron",
          "description": "Thin arrows (Nerd Font)"
        },
        {
          "value": "slash",
          "label": "Slash",
          "description": "Forward slashes"
        },
        {
          "value": "pipe",
          "label": "Pipe",
          "description": "Vertical pipes"
        },
        {
          "value": "block",
          "label": "Block",
          "description": "Solid blocks"
        },
        {
          "value": "none",
          "label": "None",
          "description": "Space only"
        },
        {
          "value": "ascii",
          "label": "ASCII",
          "description": "Greater-than signs"
        }
      ]
    }
  },
  {
    "key": "statusLine.sessionAccent",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "appearance",
      "group": "Status Line",
      "label": "Session Accent",
      "description": "Use the session name color for the editor border and status line gap"
    }
  },
  {
    "key": "statusLine.transparent",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Status Line",
      "label": "Transparent Status Line",
      "description": "Use the terminal's default background for the status line instead of the theme's `statusLineBg`. Powerline end caps are dropped because they need a contrasting fill to bridge into the surrounding terminal."
    }
  },
  {
    "key": "statusLine.compactThinkingLevel",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Status Line",
      "label": "Compact Thinking Level",
      "description": "Show the thinking level as a single icon on the model name instead of a separate ` · <level>` suffix."
    }
  },
  {
    "key": "tools.artifactSpillThreshold",
    "type": "number",
    "default": 50,
    "ui": {
      "tab": "tools",
      "group": "Output Limits",
      "label": "Artifact Spill Threshold (KB)",
      "description": "Tool output above this size is saved as an artifact; tail is kept inline",
      "options": [
        {
          "value": "1",
          "label": "1 KB",
          "description": "~250 tokens"
        },
        {
          "value": "2.5",
          "label": "2.5 KB",
          "description": "~625 tokens"
        },
        {
          "value": "5",
          "label": "5 KB",
          "description": "~1.25K tokens"
        },
        {
          "value": "10",
          "label": "10 KB",
          "description": "~2.5K tokens"
        },
        {
          "value": "20",
          "label": "20 KB",
          "description": "~5K tokens"
        },
        {
          "value": "30",
          "label": "30 KB",
          "description": "~7.5K tokens"
        },
        {
          "value": "50",
          "label": "50 KB",
          "description": "Default; ~12.5K tokens"
        },
        {
          "value": "75",
          "label": "75 KB",
          "description": "~19K tokens"
        },
        {
          "value": "100",
          "label": "100 KB",
          "description": "~25K tokens"
        },
        {
          "value": "200",
          "label": "200 KB",
          "description": "~50K tokens"
        },
        {
          "value": "500",
          "label": "500 KB",
          "description": "~125K tokens"
        },
        {
          "value": "1000",
          "label": "1 MB",
          "description": "~250K tokens"
        }
      ]
    }
  },
  {
    "key": "tools.artifactTailBytes",
    "type": "number",
    "default": 20,
    "ui": {
      "tab": "tools",
      "group": "Output Limits",
      "label": "Artifact Tail Size (KB)",
      "description": "Amount of tail content kept inline when output spills to artifact",
      "options": [
        {
          "value": "1",
          "label": "1 KB",
          "description": "~250 tokens"
        },
        {
          "value": "2.5",
          "label": "2.5 KB",
          "description": "~625 tokens"
        },
        {
          "value": "5",
          "label": "5 KB",
          "description": "~1.25K tokens"
        },
        {
          "value": "10",
          "label": "10 KB",
          "description": "~2.5K tokens"
        },
        {
          "value": "20",
          "label": "20 KB",
          "description": "Default; ~5K tokens"
        },
        {
          "value": "50",
          "label": "50 KB",
          "description": "~12.5K tokens"
        },
        {
          "value": "100",
          "label": "100 KB",
          "description": "~25K tokens"
        },
        {
          "value": "200",
          "label": "200 KB",
          "description": "~50K tokens"
        }
      ]
    }
  },
  {
    "key": "tools.artifactHeadBytes",
    "type": "number",
    "default": 20,
    "ui": {
      "tab": "tools",
      "group": "Output Limits",
      "label": "Artifact Head Size (KB)",
      "description": "Amount of head content kept inline alongside the tail when output spills to artifact (middle elision). 0 disables — keep tail only.",
      "options": [
        {
          "value": "0",
          "label": "0 KB",
          "description": "Disabled; tail-only truncation"
        },
        {
          "value": "1",
          "label": "1 KB",
          "description": "~250 tokens"
        },
        {
          "value": "2.5",
          "label": "2.5 KB",
          "description": "~625 tokens"
        },
        {
          "value": "5",
          "label": "5 KB",
          "description": "~1.25K tokens"
        },
        {
          "value": "10",
          "label": "10 KB",
          "description": "~2.5K tokens"
        },
        {
          "value": "20",
          "label": "20 KB",
          "description": "Default; ~5K tokens"
        },
        {
          "value": "50",
          "label": "50 KB",
          "description": "~12.5K tokens"
        },
        {
          "value": "100",
          "label": "100 KB",
          "description": "~25K tokens"
        },
        {
          "value": "200",
          "label": "200 KB",
          "description": "~50K tokens"
        }
      ]
    }
  },
  {
    "key": "tools.outputMaxColumns",
    "type": "number",
    "default": 768,
    "ui": {
      "tab": "tools",
      "group": "Output Limits",
      "label": "Output Column Cap",
      "description": "Per-line byte cap for streaming tool outputs (bash, python, js eval) and `read`. Lines wider than this are ellipsis-truncated; remaining bytes up to the next newline are dropped. 0 disables.",
      "options": [
        {
          "value": "0",
          "label": "Off",
          "description": "No per-line cap"
        },
        {
          "value": "256",
          "label": "256",
          "description": "Tight"
        },
        {
          "value": "512",
          "label": "512"
        },
        {
          "value": "768",
          "label": "768",
          "description": "Default"
        },
        {
          "value": "1024",
          "label": "1024"
        },
        {
          "value": "2048",
          "label": "2048"
        },
        {
          "value": "4096",
          "label": "4096",
          "description": "Loose"
        }
      ]
    }
  },
  {
    "key": "tools.artifactTailLines",
    "type": "number",
    "default": 500,
    "ui": {
      "tab": "tools",
      "group": "Output Limits",
      "label": "Artifact Tail Lines",
      "description": "Maximum lines of tail content kept inline when output spills to artifact",
      "options": [
        {
          "value": "50",
          "label": "50 lines",
          "description": "~250 tokens"
        },
        {
          "value": "100",
          "label": "100 lines",
          "description": "~500 tokens"
        },
        {
          "value": "250",
          "label": "250 lines",
          "description": "~1.25K tokens"
        },
        {
          "value": "500",
          "label": "500 lines",
          "description": "Default; ~2.5K tokens"
        },
        {
          "value": "1000",
          "label": "1000 lines",
          "description": "~5K tokens"
        },
        {
          "value": "2000",
          "label": "2000 lines",
          "description": "~10K tokens"
        },
        {
          "value": "5000",
          "label": "5000 lines",
          "description": "~25K tokens"
        }
      ]
    }
  },
  {
    "key": "statusLine.showHookStatus",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "appearance",
      "group": "Status Line",
      "label": "Show Hook Status",
      "description": "Display hook status messages below the status line"
    }
  },
  {
    "key": "terminal.showImages",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "appearance",
      "group": "Images",
      "label": "Show Inline Images",
      "description": "Render images inline in the terminal",
      "condition": "hasImageProtocol"
    }
  },
  {
    "key": "images.autoResize",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "appearance",
      "group": "Images",
      "label": "Auto-Resize Images",
      "description": "Resize large images to 2000x2000 max for better model compatibility"
    }
  },
  {
    "key": "images.blockImages",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Images",
      "label": "Block Images",
      "description": "Prevent images from being sent to LLM providers"
    }
  },
  {
    "key": "images.describeForTextModels",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "model",
      "group": "Vision",
      "label": "Describe Images for Text Models",
      "description": "When an image is attached to a model without vision support, save it under local:// and inject a description from a vision-capable model instead of dropping it"
    }
  },
  {
    "key": "tui.maxInlineImageColumns",
    "type": "number",
    "default": 100,
    "description": "Maximum width in terminal columns for inline images (default 100). Set to 0 for unlimited (bounded only by terminal width)."
  },
  {
    "key": "tui.maxInlineImageRows",
    "type": "number",
    "default": 20,
    "description": "Maximum height in terminal rows for inline images (default 20). Set to 0 to use only the viewport-based limit (60% of terminal height)."
  },
  {
    "key": "tui.maxInlineImages",
    "type": "number",
    "default": 8,
    "description": "Maximum number of inline images kept as live terminal graphics (default 8). Older images fall back to a text placeholder via a full redraw once the limit is exceeded. Set to 0 to keep every image (no limit)."
  },
  {
    "key": "terminal.showProgress",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Native Terminal Progress",
      "description": "Emit OSC 9;4 indeterminate progress while the agent or context maintenance is running"
    }
  },
  {
    "key": "tui.textSizing",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Large Headings (Kitty)",
      "description": "Render Markdown H1 headings at 2x scale using Kitty's OSC 66 text-sizing protocol. Only takes effect on Kitty terminals; ignored everywhere else. Off by default."
    }
  },
  {
    "key": "tui.renderMermaid",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Render Mermaid Diagrams",
      "description": "Render Mermaid fenced code blocks as ASCII diagrams"
    }
  },
  {
    "key": "tui.codexResetFireworks",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Codex Reset Fireworks",
      "description": "Celebrate unscheduled Codex weekly usage resets and newly banked saved resets with a top-third fireworks overlay that remains until Escape"
    }
  },
  {
    "key": "tui.titleState",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Terminal Title Run State",
      "description": "Show the agent run state in the terminal title's separator — an animated spinner while working (a static ':' on Windows), '>' when it's your turn, '!' when the agent is waiting on you"
    }
  },
  {
    "key": "tui.hyperlinks",
    "type": "enum",
    "values": [
      "off",
      "auto",
      "always"
    ],
    "default": "auto",
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Terminal Hyperlinks",
      "description": "Wrap paths and URLs in OSC 8 hyperlinks for terminal-native click-to-open (auto: detect support; off: never; always: unconditional)"
    }
  },
  {
    "key": "tui.tight",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Tight Layout",
      "description": "Remove the 1-character horizontal padding from the left and right of the terminal output"
    }
  },
  {
    "key": "tui.scrollbackRebuild",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Rewrite Scrollback",
      "description": "Erase and replay terminal scrollback when a block's final form replaces its live preview. When off (default), stale preview copies remain in history and the final content is appended below."
    }
  },
  {
    "key": "display.shimmer",
    "type": "enum",
    "values": [
      "classic",
      "kitt",
      "disabled"
    ],
    "default": "classic",
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Shimmer",
      "description": "Animation style for working/loading messages",
      "options": [
        {
          "value": "classic",
          "label": "Classic",
          "description": "Soft cosine wave sweeping across the text"
        },
        {
          "value": "kitt",
          "label": "KITT Scanner",
          "description": "Knight Rider 1982 red light bouncing left-right"
        },
        {
          "value": "disabled",
          "label": "Disabled",
          "description": "No animation; static muted text"
        }
      ]
    }
  },
  {
    "key": "display.smoothStreaming",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Smooth Streaming",
      "description": "Reveal assistant text and streamed tool input smoothly while chunks arrive"
    }
  },
  {
    "key": "display.hideToolActivity",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Hide Tool Activity",
      "description": "Hide model-initiated tool calls and results from the transcript"
    }
  },
  {
    "key": "display.showTokenUsage",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Show Token Usage",
      "description": "Show per-turn token usage on assistant messages"
    }
  },
  {
    "key": "display.cacheMissMarker",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Cache Miss Marker",
      "description": "Show a divider above an assistant turn whose request lost (missed) the prompt cache"
    }
  },
  {
    "key": "display.collapseCompacted",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Collapse Compacted History",
      "description": "Collapse pre-compaction history behind the summary divider on the live transcript; disable to keep the full transcript inline with dividers at each compaction point"
    }
  },
  {
    "key": "showHardwareCursor",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Show Hardware Cursor",
      "description": "Show terminal cursor for IME support"
    }
  },
  {
    "key": "tui.imeSafeCursor",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "IME-Safe Prompt Layout",
      "description": "Move the prompt's bottom border to a separate row so macOS IME preedit cannot displace it"
    }
  },
  {
    "key": "defaultThinkingLevel",
    "type": "enum",
    "values": [],
    "default": "high",
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Thinking Level",
      "description": "Reasoning depth for thinking-capable models"
    }
  },
  {
    "key": "hideThinkingBlock",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Hide Thinking Blocks",
      "description": "Hide thinking blocks in assistant responses"
    }
  },
  {
    "key": "proseOnlyThinking",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Prose Only Thinking",
      "description": "Omit code blocks from thinking summaries and replace them with an ellipsis"
    }
  },
  {
    "key": "omitThinking",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Omit Thinking summaries",
      "description": "Instruct upstream providers to completely omit thinking summaries from responses (where supported)"
    }
  },
  {
    "key": "externalThinking",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "External Thinking",
      "description": "Private scratchpad; not shown to user. Disables supported GPT, Claude, and Gemini reasoning"
    }
  },
  {
    "key": "model.loopGuard.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Loop Guard",
      "description": "Enable automatic stream loop detection for model reasoning and prose"
    }
  },
  {
    "key": "model.loopGuard.checkAssistantContent",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Loop Guard Scan Prose",
      "description": "Apply loop guard to assistant prose messages in addition to thinking logs"
    }
  },
  {
    "key": "model.loopGuard.toolCallReminder",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Loop Guard Tool-Call Reminder",
      "description": "When a Gemini reasoning stream emits many consecutive planning headers without calling a tool, interrupt it and inject a reminder to issue a tool call (requires Loop Guard)"
    }
  },
  {
    "key": "model.toolCallLoopGuard.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Tool-Call Loop Guard",
      "description": "Detect consecutive identical tool calls across turns and inject a corrective steer"
    }
  },
  {
    "key": "model.toolCallLoopGuard.threshold",
    "type": "number",
    "default": 5,
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Tool-Call Loop Threshold",
      "description": "Consecutive identical tool calls required before the corrective steer is injected"
    }
  },
  {
    "key": "model.toolCallLoopGuard.exemptTools",
    "type": "array",
    "default": [],
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Tool-Call Loop Exempt Tools",
      "description": "Tool names that may repeat consecutively without triggering the cross-turn loop guard"
    }
  },
  {
    "key": "inlineToolDescriptors",
    "type": "enum",
    "values": [
      "auto",
      "on",
      "off"
    ],
    "default": "auto",
    "ui": {
      "tab": "model",
      "group": "Prompt",
      "label": "Inline Tool Descriptors",
      "description": "Render full tool descriptors in the system prompt and strip top-level/nested descriptions from provider tool schemas so descriptor text is sent once. Auto enables this for Gemini models and disables it otherwise",
      "options": [
        {
          "value": "auto",
          "label": "Auto",
          "description": "Inline descriptors for Gemini models; keep them in tool schemas otherwise"
        },
        {
          "value": "on",
          "label": "On",
          "description": "Always inline descriptors in the system prompt"
        },
        {
          "value": "off",
          "label": "Off",
          "description": "Keep descriptors in provider tool schemas only"
        }
      ]
    }
  },
  {
    "key": "includeModelInPrompt",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "model",
      "group": "Prompt",
      "label": "Include Model in Prompt",
      "description": "Surface the active model identifier in the system prompt so the agent knows which model it is"
    }
  },
  {
    "key": "includeWorkspaceTree",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "model",
      "group": "Prompt",
      "label": "Include Workspace Tree",
      "description": "Render the workspace directory tree in the system prompt. WARNING: This can bust prompt caching across sessions when files are modified."
    }
  },
  {
    "key": "workspace.additionalDirectories",
    "type": "array",
    "default": [],
    "ui": {
      "tab": "context",
      "group": "General",
      "label": "Additional Workspace Dirs",
      "description": "Extra workspace directories added to every session as additional roots (multi-root workspace). Managed live via /add-dir and /remove-dir. Paths resolve relative to cwd; absolute paths recommended. The agent is told these roots exist and can read/grep/glob them."
    }
  },
  {
    "key": "personality",
    "type": "enum",
    "values": [
      "default",
      "friendly",
      "pragmatic",
      "none"
    ],
    "default": "default",
    "ui": {
      "tab": "model",
      "group": "Prompt",
      "label": "Personality",
      "description": "Communication style rendered into the system prompt's personality block",
      "options": [
        {
          "value": "default",
          "label": "Default",
          "description": "Terse, evidence-first engineer; dense, action-oriented replies"
        },
        {
          "value": "friendly",
          "label": "Friendly",
          "description": "Warm, encouraging collaborator focused on momentum and morale"
        },
        {
          "value": "pragmatic",
          "label": "Pragmatic",
          "description": "Direct, efficient engineer focused on clarity and rigor"
        },
        {
          "value": "none",
          "label": "None",
          "description": "Omit the personality block entirely"
        }
      ]
    }
  },
  {
    "key": "temperature",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Temperature",
      "description": "Sampling temperature (0 = deterministic, 1 = creative, -1 = provider default)",
      "options": [
        {
          "value": "-1",
          "label": "Default",
          "description": "Use provider default"
        },
        {
          "value": "0",
          "label": "0",
          "description": "Deterministic"
        },
        {
          "value": "0.2",
          "label": "0.2",
          "description": "Focused"
        },
        {
          "value": "0.5",
          "label": "0.5",
          "description": "Balanced"
        },
        {
          "value": "0.7",
          "label": "0.7",
          "description": "Creative"
        },
        {
          "value": "1",
          "label": "1",
          "description": "Maximum variety"
        }
      ]
    }
  },
  {
    "key": "topP",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Top P",
      "description": "Nucleus sampling cutoff (0-1, -1 = provider default)",
      "options": [
        {
          "value": "-1",
          "label": "Default",
          "description": "Use provider default"
        },
        {
          "value": "0.1",
          "label": "0.1",
          "description": "Very focused"
        },
        {
          "value": "0.3",
          "label": "0.3",
          "description": "Focused"
        },
        {
          "value": "0.5",
          "label": "0.5",
          "description": "Balanced"
        },
        {
          "value": "0.9",
          "label": "0.9",
          "description": "Broad"
        },
        {
          "value": "1",
          "label": "1",
          "description": "No nucleus filtering"
        }
      ]
    }
  },
  {
    "key": "topK",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Top K",
      "description": "Sample from top-K tokens (-1 = provider default)",
      "options": [
        {
          "value": "-1",
          "label": "Default",
          "description": "Use provider default"
        },
        {
          "value": "1",
          "label": "1",
          "description": "Greedy top token"
        },
        {
          "value": "20",
          "label": "20",
          "description": "Focused"
        },
        {
          "value": "40",
          "label": "40",
          "description": "Balanced"
        },
        {
          "value": "100",
          "label": "100",
          "description": "Broad"
        }
      ]
    }
  },
  {
    "key": "minP",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Min P",
      "description": "Minimum probability threshold (0-1, -1 = provider default)",
      "options": [
        {
          "value": "-1",
          "label": "Default",
          "description": "Use provider default"
        },
        {
          "value": "0.01",
          "label": "0.01",
          "description": "Very permissive"
        },
        {
          "value": "0.05",
          "label": "0.05",
          "description": "Balanced"
        },
        {
          "value": "0.1",
          "label": "0.1",
          "description": "Strict"
        }
      ]
    }
  },
  {
    "key": "presencePenalty",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Presence Penalty",
      "description": "Penalty for introducing already-present tokens (-1 = provider default)",
      "options": [
        {
          "value": "-1",
          "label": "Default",
          "description": "Use provider default"
        },
        {
          "value": "0",
          "label": "0",
          "description": "No penalty"
        },
        {
          "value": "0.5",
          "label": "0.5",
          "description": "Mild novelty"
        },
        {
          "value": "1",
          "label": "1",
          "description": "Encourage novelty"
        },
        {
          "value": "2",
          "label": "2",
          "description": "Strong novelty"
        }
      ]
    }
  },
  {
    "key": "repetitionPenalty",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Repetition Penalty",
      "description": "Penalty for repeated tokens (-1 = provider default)",
      "options": [
        {
          "value": "-1",
          "label": "Default",
          "description": "Use provider default"
        },
        {
          "value": "0.8",
          "label": "0.8",
          "description": "Allow repetition"
        },
        {
          "value": "1",
          "label": "1",
          "description": "No penalty"
        },
        {
          "value": "1.1",
          "label": "1.1",
          "description": "Mild penalty"
        },
        {
          "value": "1.2",
          "label": "1.2",
          "description": "Balanced"
        },
        {
          "value": "1.5",
          "label": "1.5",
          "description": "Strong penalty"
        }
      ]
    }
  },
  {
    "key": "textVerbosity",
    "type": "enum",
    "values": [
      "low",
      "medium",
      "high"
    ],
    "default": "medium",
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Text Verbosity",
      "description": "OpenAI Responses and Codex response verbosity (low, medium, or high)",
      "options": [
        {
          "value": "low",
          "label": "Low",
          "description": "Prefer concise responses"
        },
        {
          "value": "medium",
          "label": "Medium",
          "description": "Balance brevity and detail (default)"
        },
        {
          "value": "high",
          "label": "High",
          "description": "Prefer detailed responses"
        }
      ]
    }
  },
  {
    "key": "tier.openai",
    "type": "enum",
    "default": "none",
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Service Tier \\u2014 OpenAI",
      "description": "Processing tier for OpenAI / OpenAI-Codex requests, and OpenAI-family models routed via OpenRouter (none = omit). Sent as `service_tier`."
    },
    "values": [
      "none",
      "auto",
      "default",
      "flex",
      "priority",
      "scale"
    ]
  },
  {
    "key": "tier.anthropic",
    "type": "enum",
    "default": "none",
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Service Tier \\u2014 Anthropic",
      "description": "Processing tier for Claude requests. `priority` realizes fast mode (`speed: \"fast\"`) on supported direct Anthropic models; ignored on Bedrock/Vertex Claude and via OpenRouter."
    },
    "values": [
      "none",
      "auto",
      "default",
      "flex",
      "priority"
    ]
  },
  {
    "key": "tier.google",
    "type": "enum",
    "default": "none",
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Service Tier \\u2014 Google",
      "description": "Processing tier for Gemini (Google AI Studio + Vertex) requests, and Google-family models routed via OpenRouter (none = omit). Sent as the top-level `serviceTier` field."
    },
    "values": [
      "none",
      "auto",
      "default",
      "flex",
      "priority"
    ]
  },
  {
    "key": "tier.subagent",
    "type": "enum",
    "default": "inherit",
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Service Tier \\u2014 Subagent",
      "description": "Service Tier for spawned task/eval subagents. Inherit = match the main agent's live per-family tiers (tracks /fast); pick a value to apply it to whichever family the subagent's model belongs to."
    },
    "values": [
      "inherit",
      "none",
      "auto",
      "default",
      "flex",
      "priority"
    ]
  },
  {
    "key": "tier.advisor",
    "type": "enum",
    "default": "none",
    "ui": {
      "tab": "model",
      "group": "Sampling",
      "label": "Service Tier \\u2014 Advisor",
      "description": "Service Tier for the advisor model. None = standard processing; Inherit = match the main agent's live per-family tiers; pick a value to apply it to the advisor model's family."
    },
    "values": [
      "inherit",
      "none",
      "auto",
      "default",
      "flex",
      "priority"
    ]
  },
  {
    "key": "retry.maxRetries",
    "type": "number",
    "default": 10,
    "ui": {
      "tab": "model",
      "group": "Retry & Fallback",
      "label": "Retry Attempts",
      "description": "Maximum retry attempts on API errors",
      "options": [
        {
          "value": "1",
          "label": "1 retry"
        },
        {
          "value": "2",
          "label": "2 retries"
        },
        {
          "value": "3",
          "label": "3 retries"
        },
        {
          "value": "5",
          "label": "5 retries"
        },
        {
          "value": "10",
          "label": "10 retries"
        }
      ]
    }
  },
  {
    "key": "retry.maxDelayMs",
    "type": "number",
    "default": 300000,
    "ui": {
      "tab": "model",
      "group": "Retry & Fallback",
      "label": "Max Retry Delay",
      "description": "Maximum wait between retries, in ms. When the provider asks us to wait longer than this and no credential or model fallback succeeds, the request fails fast instead of sleeping (e.g. 3-hour Anthropic rate-limit windows)."
    }
  },
  {
    "key": "retry.modelFallback",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "model",
      "group": "Retry & Fallback",
      "label": "Retry Model Fallback",
      "description": "Allow retry recovery to switch to configured fallback models"
    }
  },
  {
    "key": "retry.usageAwareFallback",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "model",
      "group": "Retry & Fallback",
      "label": "Usage-Aware Fallback",
      "description": "Use reliable coding-plan quota reports to prefer same-provider accounts, then configured fallback models, before a hard usage limit. Ordinary configured API keys are excluded."
    }
  },
  {
    "key": "retry.usageReservePct",
    "type": "number",
    "default": 10,
    "ui": {
      "tab": "model",
      "group": "Retry & Fallback",
      "label": "Reserve Margin",
      "description": "Treat a coding-plan model as near its limit below this remaining percentage. Unknown or unmapped usage keeps the primary model.",
      "condition": "usageAwareFallbackEnabled",
      "options": [
        {
          "value": "5",
          "label": "5%",
          "description": "Act only when nearly exhausted"
        },
        {
          "value": "10",
          "label": "10%",
          "description": "Balanced safety margin"
        },
        {
          "value": "15",
          "label": "15%",
          "description": "Conservative"
        },
        {
          "value": "20",
          "label": "20%",
          "description": "Early protection"
        },
        {
          "value": "25",
          "label": "25%",
          "description": "Very conservative"
        }
      ]
    }
  },
  {
    "key": "retry.usageReservePolicy",
    "type": "enum",
    "values": [
      "confirm",
      "auto",
      "fail-closed"
    ],
    "default": "confirm",
    "ui": {
      "tab": "model",
      "group": "Retry & Fallback",
      "label": "Reserve Policy",
      "description": "What to do when every same-provider coding-plan account is inside the reserve margin.",
      "condition": "usageAwareFallbackEnabled",
      "options": [
        {
          "value": "confirm",
          "label": "Confirm interactively",
          "description": "Keep interactive sessions on the primary until confirmed; background agents auto-fallback"
        },
        {
          "value": "auto",
          "label": "Auto-fallback",
          "description": "Always select the next eligible configured fallback"
        },
        {
          "value": "fail-closed",
          "label": "Fail closed",
          "description": "Do not spend reserve quota or select a fallback"
        }
      ]
    }
  },
  {
    "key": "retry.fallbackChains",
    "type": "record",
    "default": {},
    "ui": {
      "tab": "model",
      "group": "Retry & Fallback",
      "label": "Retry Fallback Chains",
      "description": "JSON object mapping model roles, model selectors (\"provider/model-id\"), or provider wildcards (\"provider/*\") to ordered fallback selectors, e.g. {\"default\":[\"openai/gpt-4o-mini\"],\"google-antigravity/*\":[\"google/*\",\"google-vertex/*\"]}. Model-oriented keys apply whenever that model/provider is active, regardless of role; a \"provider/*\" entry keeps the failing model's id and swaps the provider. An id-prefixed wildcard (\"openrouter/google/*\") re-prefixes the failing model's bare id (google-antigravity/gemini-x -> openrouter/google/gemini-x) and, used as a key, matches only that provider's ids under the prefix."
    }
  },
  {
    "key": "retry.fallbackRevertPolicy",
    "type": "enum",
    "values": [
      "cooldown-expiry",
      "never"
    ],
    "default": "cooldown-expiry",
    "ui": {
      "tab": "model",
      "group": "Retry & Fallback",
      "label": "Fallback Revert Policy",
      "description": "When to return to the primary model after a fallback",
      "options": [
        {
          "value": "cooldown-expiry",
          "label": "Cooldown expiry",
          "description": "Return to the primary model after its suppression window ends"
        },
        {
          "value": "never",
          "label": "Never",
          "description": "Stay on the fallback model until manually changed"
        }
      ]
    }
  },
  {
    "key": "providers.anthropic.serverSideFallback",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "model",
      "group": "Retry & Fallback",
      "label": "Anthropic Server-Side Fallback (Fable 5)",
      "description": "When a Claude Fable 5 / Mythos 5 request is blocked by Anthropic's safety classifier, retry it on Claude Opus 4.8 server-side (Anthropic `server-side-fallback-2026-06-01` beta). Opt-in — leaving this off preserves the pre-fallback behavior for every request."
    }
  },
  {
    "key": "steeringMode",
    "type": "enum",
    "values": [
      "all",
      "one-at-a-time"
    ],
    "default": "one-at-a-time",
    "ui": {
      "tab": "interaction",
      "group": "Input",
      "label": "Steering Mode",
      "description": "How to process queued messages while agent is working"
    }
  },
  {
    "key": "followUpMode",
    "type": "enum",
    "values": [
      "all",
      "one-at-a-time"
    ],
    "default": "one-at-a-time",
    "ui": {
      "tab": "interaction",
      "group": "Input",
      "label": "Follow-Up Mode",
      "description": "How to drain follow-up messages after a turn completes"
    }
  },
  {
    "key": "interruptMode",
    "type": "enum",
    "values": [
      "immediate",
      "wait"
    ],
    "default": "immediate",
    "ui": {
      "tab": "interaction",
      "group": "Input",
      "label": "Interrupt Mode",
      "description": "When steering messages interrupt tool execution"
    }
  },
  {
    "key": "loop.mode",
    "type": "enum",
    "values": [
      "prompt",
      "compact",
      "reset"
    ],
    "default": "prompt",
    "ui": {
      "tab": "interaction",
      "group": "Input",
      "label": "Loop Mode",
      "description": "What happens between /loop iterations before re-submitting the prompt",
      "options": [
        {
          "value": "prompt",
          "label": "Prompt",
          "description": "Re-submit the prompt as a follow-up message (current behavior)"
        },
        {
          "value": "compact",
          "label": "Compact",
          "description": "Compact the session context, then re-submit the prompt"
        },
        {
          "value": "reset",
          "label": "Reset",
          "description": "Start a new session, then re-submit the prompt"
        }
      ]
    }
  },
  {
    "key": "doubleEscapeAction",
    "type": "enum",
    "values": [
      "branch",
      "tree",
      "none"
    ],
    "default": "tree",
    "ui": {
      "tab": "interaction",
      "group": "Input",
      "label": "Double-Escape Action",
      "description": "Action when pressing Escape twice with empty editor"
    }
  },
  {
    "key": "treeFilterMode",
    "type": "enum",
    "values": [
      "default",
      "no-tools",
      "user-only",
      "labeled-only",
      "all"
    ],
    "default": "default",
    "ui": {
      "tab": "interaction",
      "group": "Input",
      "label": "Session Tree Filter",
      "description": "Default filter mode when opening the session tree"
    }
  },
  {
    "key": "autocompleteMaxVisible",
    "type": "number",
    "default": 5,
    "ui": {
      "tab": "interaction",
      "group": "Input",
      "label": "Autocomplete Items",
      "description": "Max visible items in autocomplete dropdown (3-20)",
      "options": [
        {
          "value": "3",
          "label": "3 items"
        },
        {
          "value": "5",
          "label": "5 items"
        },
        {
          "value": "7",
          "label": "7 items"
        },
        {
          "value": "10",
          "label": "10 items"
        },
        {
          "value": "15",
          "label": "15 items"
        },
        {
          "value": "20",
          "label": "20 items"
        }
      ]
    }
  },
  {
    "key": "emojiAutocomplete",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Input",
      "label": "Emoji Autocomplete",
      "description": "Suggest emojis from `:name:` shortcodes and expand text emoticons like `:D` or `:-)`"
    }
  },
  {
    "key": "paste.largeMenuThreshold",
    "type": "number",
    "default": 100,
    "ui": {
      "tab": "interaction",
      "group": "Input",
      "label": "Large Paste Menu",
      "description": "When a paste reaches this many lines, offer a menu to wrap it in a code block, wrap it in XML tags, or save it to a file. 0 disables the menu (large pastes still collapse to a [Paste] marker).",
      "options": [
        {
          "value": "0",
          "label": "Off"
        },
        {
          "value": "100",
          "label": "100 lines"
        },
        {
          "value": "250",
          "label": "250 lines"
        },
        {
          "value": "500",
          "label": "500 lines"
        },
        {
          "value": "1000",
          "label": "1000 lines"
        }
      ]
    }
  },
  {
    "key": "startup.quiet",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "interaction",
      "group": "Startup & Updates",
      "label": "Quiet Startup",
      "description": "Skip welcome screen and startup status messages"
    }
  },
  {
    "key": "startup.showSplash",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "interaction",
      "group": "Startup & Updates",
      "label": "Show Startup Splash",
      "description": "Show the full animated setup splash on normal interactive startup without rerunning setup. Quiet Startup still suppresses it."
    }
  },
  {
    "key": "startup.setupWizard",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Startup & Updates",
      "label": "Setup Wizard",
      "description": "Show newly added onboarding steps once per setup version"
    }
  },
  {
    "key": "startup.checkUpdate",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Startup & Updates",
      "label": "Check for Updates",
      "description": "Check for omp updates on startup"
    }
  },
  {
    "key": "marketplace.autoUpdate",
    "type": "enum",
    "values": [
      "off",
      "notify",
      "auto"
    ],
    "default": "notify",
    "ui": {
      "tab": "interaction",
      "group": "Startup & Updates",
      "label": "Marketplace Auto-Update",
      "description": "Check for plugin updates on startup",
      "options": [
        {
          "value": "off",
          "label": "Off",
          "description": "Don't check for plugin updates"
        },
        {
          "value": "notify",
          "label": "Notify",
          "description": "Check on startup and notify when updates are available"
        },
        {
          "value": "auto",
          "label": "Auto",
          "description": "Check on startup and auto-install updates"
        }
      ]
    }
  },
  {
    "key": "startup.changelogMode",
    "type": "enum",
    "values": [
      "summary",
      "expanded",
      "hidden"
    ],
    "default": "summary",
    "ui": {
      "tab": "interaction",
      "group": "Startup & Updates",
      "label": "Startup Changelog",
      "description": "Choose whether update notes start as a summary, full details, or stay hidden",
      "options": [
        {
          "value": "summary",
          "label": "Summary",
          "description": "Show release and change counts with a /changelog hint"
        },
        {
          "value": "expanded",
          "label": "Expanded",
          "description": "Show the recent release notes in full"
        },
        {
          "value": "hidden",
          "label": "Hidden",
          "description": "Do not show release notes on startup"
        }
      ]
    }
  },
  {
    "key": "magicKeywords.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Magic Keywords",
      "label": "Magic Keywords",
      "description": "Enable hidden notices for standalone ultrathink, orchestrate, and workflowz keywords"
    }
  },
  {
    "key": "magicKeywords.ultrathink",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Magic Keywords",
      "label": "Ultrathink Keyword",
      "description": "Let standalone ultrathink request maximum automatic thinking and append its hidden notice"
    }
  },
  {
    "key": "magicKeywords.orchestrate",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Magic Keywords",
      "label": "Orchestrate Keyword",
      "description": "Let standalone orchestrate append its hidden multi-agent orchestration notice"
    }
  },
  {
    "key": "magicKeywords.workflow",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Magic Keywords",
      "label": "Workflow Keyword",
      "description": "Let standalone workflowz append its hidden eval workflow notice"
    }
  },
  {
    "key": "completion.notify",
    "type": "enum",
    "values": [
      "on",
      "off"
    ],
    "default": "on",
    "ui": {
      "tab": "interaction",
      "group": "Notifications",
      "label": "Completion Notification",
      "description": "Notify when the agent finishes a turn"
    }
  },
  {
    "key": "error.notify",
    "type": "enum",
    "values": [
      "on",
      "off"
    ],
    "default": "off",
    "ui": {
      "tab": "interaction",
      "group": "Notifications",
      "label": "Error Notification",
      "description": "Notify when the agent stops with an error"
    }
  },
  {
    "key": "ask.timeout",
    "type": "number",
    "default": 0,
    "ui": {
      "tab": "interaction",
      "group": "Notifications",
      "label": "Ask Timeout",
      "description": "Auto-select the recommended ask option after this many seconds (0 disables)",
      "options": [
        {
          "value": "0",
          "label": "Disabled"
        },
        {
          "value": "15",
          "label": "15 seconds"
        },
        {
          "value": "30",
          "label": "30 seconds"
        },
        {
          "value": "60",
          "label": "60 seconds"
        },
        {
          "value": "120",
          "label": "120 seconds"
        }
      ]
    }
  },
  {
    "key": "ask.notify",
    "type": "enum",
    "values": [
      "on",
      "off"
    ],
    "default": "on",
    "ui": {
      "tab": "interaction",
      "group": "Notifications",
      "label": "Ask Notification",
      "description": "Notify when the ask tool is waiting for input"
    }
  },
  {
    "key": "recap.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Notifications",
      "label": "Idle Recap",
      "description": "Generate a brief LLM recap of where things stand after the terminal has been idle"
    }
  },
  {
    "key": "recap.idleSeconds",
    "type": "number",
    "default": 240,
    "ui": {
      "tab": "interaction",
      "group": "Notifications",
      "label": "Idle Recap Delay",
      "description": "Seconds to wait while idle before showing the recap",
      "options": [
        {
          "value": "60",
          "label": "1 minute"
        },
        {
          "value": "120",
          "label": "2 minutes"
        },
        {
          "value": "240",
          "label": "4 minutes"
        },
        {
          "value": "300",
          "label": "5 minutes"
        },
        {
          "value": "600",
          "label": "10 minutes"
        }
      ]
    }
  },
  {
    "key": "collab.relayUrl",
    "type": "string",
    "default": "wss://my.omp.sh",
    "ui": {
      "tab": "interaction",
      "group": "Collab",
      "label": "Relay URL",
      "description": "Relay used by /collab (wss://host[:port])"
    }
  },
  {
    "key": "collab.webUrl",
    "type": "string",
    "default": "",
    "ui": {
      "tab": "interaction",
      "group": "Collab",
      "label": "Web UI URL",
      "description": "Browser UI used by /collab links; empty derives from collab.relayUrl; explicit http:// is localhost-only"
    }
  },
  {
    "key": "collab.displayName",
    "type": "string",
    "default": "",
    "ui": {
      "tab": "interaction",
      "group": "Collab",
      "label": "Display Name",
      "description": "Name shown to other collab participants (default: OS username)"
    }
  },
  {
    "key": "share.serverUrl",
    "type": "string",
    "default": "https://my.omp.sh/s",
    "ui": {
      "tab": "interaction",
      "group": "Collab",
      "label": "Share Server",
      "description": "Share viewer/upload base used by /share (encrypted blob upload + viewer; links are <base>/<id>#<key>)"
    }
  },
  {
    "key": "share.store",
    "type": "enum",
    "values": [
      "blob",
      "gist"
    ],
    "default": "blob",
    "ui": {
      "tab": "interaction",
      "group": "Collab",
      "label": "Share Store",
      "description": "Where /share uploads the encrypted session blob",
      "options": [
        {
          "value": "blob",
          "label": "Encrypted Blob",
          "description": "Upload to the share server (no GitHub account needed; avoids gist API rate limits)"
        },
        {
          "value": "gist",
          "label": "GitHub Gist",
          "description": "Push to a secret gist (needs authenticated gh), falling back to the share server"
        }
      ]
    }
  },
  {
    "key": "share.redactSecrets",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "interaction",
      "group": "Collab",
      "label": "Share Secret Redaction",
      "description": "Run the secret obfuscator over /share snapshots before upload (uses the secrets.* config)"
    }
  },
  {
    "key": "stt.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "interaction",
      "group": "Speech",
      "label": "Speech-to-Text",
      "description": "Enable speech-to-text input via microphone"
    }
  },
  {
    "key": "stt.language",
    "type": "string",
    "default": "en"
  },
  {
    "key": "stt.modelName",
    "type": "enum",
    "default": "parakeet",
    "ui": {
      "tab": "interaction",
      "group": "Speech",
      "label": "Speech Model",
      "description": "Local on-device speech model. Parakeet TDT v3 (sherpa-onnx) is the SoTA default; Whisper base/small/large-v3-turbo tiers (transformers.js) trade size for multilingual coverage. Downloaded on first use."
    }
  },
  {
    "key": "stt.submitTrigger",
    "type": "enum",
    "default": "never",
    "ui": {
      "tab": "interaction",
      "group": "Speech",
      "label": "Speech-to-Text Submit Trigger",
      "description": "Choose when speech dictation automatically submits: Never, Release (2+ words), Release with complete sentence, or When I Say Submit."
    },
    "values": [
      "never",
      "enter",
      "blur"
    ]
  },
  {
    "key": "contextPromotion.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "context",
      "group": "General",
      "label": "Auto-Promote Context",
      "description": "Promote to a larger-context model on context overflow instead of compacting"
    }
  },
  {
    "key": "compaction.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Auto-Compact",
      "description": "Automatically compact context when it gets too large"
    }
  },
  {
    "key": "compaction.midTurnEnabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Mid-Turn Compaction",
      "description": "Check thresholds at safe mid-turn tool-loop boundaries before the next provider request"
    }
  },
  {
    "key": "compaction.strategy",
    "type": "enum",
    "values": [
      "context-full",
      "handoff",
      "shake",
      "snapcompact",
      "off"
    ],
    "default": "snapcompact",
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Compaction Strategy",
      "description": "Choose in-place context-full maintenance, auto-handoff, surgical shake (drop heavy content), snapcompact (archive history as dense images), or disable auto maintenance (off)",
      "options": [
        {
          "value": "context-full",
          "label": "Context-full",
          "description": "Summarize in-place and keep the current session"
        },
        {
          "value": "handoff",
          "label": "Handoff",
          "description": "Generate handoff and continue in a new session"
        },
        {
          "value": "shake",
          "label": "Shake",
          "description": "Drop heavy content (tool results + large blocks) in place; recover via artifact"
        },
        {
          "value": "snapcompact",
          "label": "Snapcompact",
          "description": "Archive history onto dense bitmap images the model reads back; no LLM call"
        },
        {
          "value": "off",
          "label": "Off",
          "description": "Disable automatic context maintenance (same behavior as Auto-compact off)"
        }
      ]
    }
  },
  {
    "key": "compaction.thresholdPercent",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Compaction Threshold",
      "description": "Percent threshold for context maintenance; set to Default to use legacy reserve-based behavior",
      "options": [
        {
          "value": "default",
          "label": "Default",
          "description": "Legacy reserve-based threshold"
        },
        {
          "value": "10",
          "label": "10%",
          "description": "Extremely early maintenance"
        },
        {
          "value": "20",
          "label": "20%",
          "description": "Very early maintenance"
        },
        {
          "value": "30",
          "label": "30%",
          "description": "Early maintenance"
        },
        {
          "value": "40",
          "label": "40%",
          "description": "Moderately early maintenance"
        },
        {
          "value": "50",
          "label": "50%",
          "description": "Halfway point"
        },
        {
          "value": "60",
          "label": "60%",
          "description": "Moderate context usage"
        },
        {
          "value": "70",
          "label": "70%",
          "description": "Balanced"
        },
        {
          "value": "75",
          "label": "75%",
          "description": "Slightly aggressive"
        },
        {
          "value": "80",
          "label": "80%",
          "description": "Typical threshold"
        },
        {
          "value": "85",
          "label": "85%",
          "description": "Aggressive context usage"
        },
        {
          "value": "90",
          "label": "90%",
          "description": "Very aggressive"
        },
        {
          "value": "95",
          "label": "95%",
          "description": "Near context limit"
        }
      ]
    }
  },
  {
    "key": "compaction.thresholdTokens",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Compaction Token Limit",
      "description": "Fixed token limit for context maintenance; overrides percentage if set",
      "options": [
        {
          "value": "default",
          "label": "Default",
          "description": "Use percentage-based threshold"
        },
        {
          "value": "25000",
          "label": "25K tokens",
          "description": "Quarter of a 200K window"
        },
        {
          "value": "50000",
          "label": "50K tokens",
          "description": "Half of a 200K window"
        },
        {
          "value": "100000",
          "label": "100K tokens",
          "description": "Half of a 200K window"
        },
        {
          "value": "150000",
          "label": "150K tokens",
          "description": "Three-quarters of a 200K window"
        },
        {
          "value": "200000",
          "label": "200K tokens",
          "description": "Full standard context window"
        },
        {
          "value": "300000",
          "label": "300K tokens",
          "description": "Large context window"
        },
        {
          "value": "500000",
          "label": "500K tokens",
          "description": "Very large context window"
        }
      ]
    }
  },
  {
    "key": "compaction.handoffSaveToDisk",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Save Handoff Docs",
      "description": "Save generated handoff documents to markdown files for the auto-handoff flow"
    }
  },
  {
    "key": "compaction.remoteEnabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Remote Compaction",
      "description": "Use remote compaction endpoints when available instead of local summarization"
    }
  },
  {
    "key": "compaction.remoteStreamingV2Enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Remote Compaction V2",
      "description": "Use Responses streaming compaction for compatible remote compaction models"
    }
  },
  {
    "key": "compaction.idleEnabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Idle Compaction",
      "description": "Compact context while idle when token count exceeds threshold"
    }
  },
  {
    "key": "compaction.idleThresholdTokens",
    "type": "number",
    "default": 200000,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Idle Compaction Threshold",
      "description": "Token count above which idle compaction triggers",
      "options": [
        {
          "value": "100000",
          "label": "100K tokens"
        },
        {
          "value": "200000",
          "label": "200K tokens"
        },
        {
          "value": "300000",
          "label": "300K tokens"
        },
        {
          "value": "400000",
          "label": "400K tokens"
        },
        {
          "value": "500000",
          "label": "500K tokens"
        },
        {
          "value": "600000",
          "label": "600K tokens"
        },
        {
          "value": "700000",
          "label": "700K tokens"
        },
        {
          "value": "800000",
          "label": "800K tokens"
        },
        {
          "value": "900000",
          "label": "900K tokens"
        }
      ]
    }
  },
  {
    "key": "compaction.idleTimeoutSeconds",
    "type": "number",
    "default": 300,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Idle Compaction Delay",
      "description": "Seconds to wait while idle before compacting",
      "options": [
        {
          "value": "60",
          "label": "1 minute"
        },
        {
          "value": "120",
          "label": "2 minutes"
        },
        {
          "value": "300",
          "label": "5 minutes"
        },
        {
          "value": "600",
          "label": "10 minutes"
        },
        {
          "value": "1800",
          "label": "30 minutes"
        },
        {
          "value": "3600",
          "label": "1 hour"
        }
      ]
    }
  },
  {
    "key": "compaction.supersedeReads",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Supersede Stale Reads",
      "description": "Prune older read results when the same file is read again (cache-aware, runs every turn)"
    }
  },
  {
    "key": "compaction.dropUseless",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "context",
      "group": "Compaction",
      "label": "Elide Uneventful Results",
      "description": "Prune tool results flagged contextually useless (no matches, timed-out waits) once consumed (cache-aware)"
    }
  },
  {
    "key": "snapcompact.systemPrompt",
    "type": "enum",
    "values": [
      "none",
      "agents-md",
      "all"
    ],
    "default": "none",
    "ui": {
      "tab": "context",
      "group": "Experimental",
      "label": "Snapcompact System Prompt",
      "description": "Experimental: render selected system prompt text as dense PNG image(s) and attach to the first user message (vision models only). Saves tokens; loses prompt caching for imaged text.",
      "options": [
        {
          "value": "none",
          "label": "None",
          "description": "Keep the system prompt as text."
        },
        {
          "value": "agents-md",
          "label": "AGENTS.md",
          "description": "Only move loaded context-file instructions to images, when that saves tokens."
        },
        {
          "value": "all",
          "label": "All",
          "description": "Move the full system prompt to images, when that saves tokens."
        }
      ]
    }
  },
  {
    "key": "snapcompact.toolResults",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "context",
      "group": "Experimental",
      "label": "Snapcompact Tool Results",
      "description": "Experimental: render large historical tool results as dense PNG image(s) instead of text (vision models only). Saves tokens on accumulated read/search output."
    }
  },
  {
    "key": "tools.format",
    "type": "enum",
    "values": [
      "auto",
      "native",
      "glm",
      "hermes",
      "kimi",
      "xml",
      "anthropic",
      "deepseek",
      "harmony",
      "qwen3",
      "gemini",
      "gemma",
      "minimax"
    ],
    "default": "auto",
    "ui": {
      "tab": "context",
      "group": "Experimental",
      "label": "Tool Calling Mode",
      "description": "Controls how tools are exposed to the model. Auto uses provider-native tool calls unless the selected model is marked as not supporting them, then falls back to the GLM owned dialect. Native forces provider-native tools; the other values force the named owned dialect. Applies on session start.",
      "options": [
        {
          "value": "auto",
          "label": "Auto",
          "description": "Use native tool calls unless the model is known not to support them."
        },
        {
          "value": "native",
          "label": "Native",
          "description": "Use provider-native tool calls."
        },
        {
          "value": "glm",
          "label": "GLM",
          "description": "Use GLM-style in-band tool calls."
        },
        {
          "value": "hermes",
          "label": "Hermes",
          "description": "Use Hermes-style in-band tool calls."
        },
        {
          "value": "kimi",
          "label": "Kimi",
          "description": "Use Kimi-style in-band tool calls."
        },
        {
          "value": "xml",
          "label": "XML",
          "description": "Use generic XML in-band tool calls."
        },
        {
          "value": "anthropic",
          "label": "Anthropic",
          "description": "Use Anthropic-style in-band tool calls."
        },
        {
          "value": "deepseek",
          "label": "DeepSeek",
          "description": "Use DeepSeek-style in-band tool calls."
        },
        {
          "value": "harmony",
          "label": "Harmony",
          "description": "Use Harmony-style in-band tool calls."
        },
        {
          "value": "qwen3",
          "label": "Qwen3",
          "description": "Use the Qwen3 owned dialect."
        },
        {
          "value": "gemini",
          "label": "Gemini",
          "description": "Use the Gemini owned dialect."
        },
        {
          "value": "gemma",
          "label": "Gemma",
          "description": "Use the Gemma owned dialect."
        },
        {
          "value": "minimax",
          "label": "MiniMax",
          "description": "Use the MiniMax owned dialect."
        }
      ]
    }
  },
  {
    "key": "snapcompact.shape",
    "type": "enum",
    "values": [
      "auto"
    ],
    "default": "auto",
    "ui": {
      "tab": "context",
      "group": "Experimental",
      "label": "Snapcompact Shape",
      "description": "Frame shape snapcompact prints text with (compaction archive and inline imaging). Auto picks a shape tuned for the current model."
    }
  },
  {
    "key": "branchSummary.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "context",
      "group": "General",
      "label": "Branch Summaries",
      "description": "Prompt to summarize when leaving a branch"
    }
  },
  {
    "key": "memories.enabled",
    "type": "boolean",
    "default": false
  },
  {
    "key": "memory.backend",
    "type": "enum",
    "values": [
      "off",
      "local",
      "hindsight",
      "mnemopi"
    ],
    "default": "off",
    "ui": {
      "tab": "memory",
      "group": "General",
      "label": "Memory Backend",
      "description": "Off, local summary pipeline, Mnemopi SQLite, or Hindsight remote memory",
      "options": [
        {
          "value": "off",
          "label": "Off",
          "description": "No memory subsystem runs"
        },
        {
          "value": "local",
          "label": "Local",
          "description": "Local rollout summarisation pipeline (memory_summary.md)"
        },
        {
          "value": "hindsight",
          "label": "Hindsight",
          "description": "Vectorize Hindsight remote memory service"
        },
        {
          "value": "mnemopi",
          "label": "Mnemopi",
          "description": "Local SQLite recall/retain backend with optional embeddings"
        }
      ]
    }
  },
  {
    "key": "autolearn.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "memory",
      "group": "Auto-Learn",
      "label": "Auto-Learn (experimental)",
      "description": "After the agent stops, nudge it to capture lessons to memory and create/enhance isolated managed skills"
    }
  },
  {
    "key": "autolearn.autoContinue",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "memory",
      "group": "Auto-Learn",
      "label": "Auto-run capture at stop",
      "description": "When on, auto-run one private capture turn at stop (uses extra tokens). When off, only standing auto-learn guidance remains.",
      "condition": "autolearnActive"
    }
  },
  {
    "key": "mnemopi.dbPath",
    "type": "string",
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi DB Path",
      "description": "Optional SQLite DB path. Defaults to the agent memories directory.",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.bank",
    "type": "string",
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Bank",
      "description": "Optional shared bank base name. Per-project modes derive project-local banks from it.",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.scoping",
    "type": "enum",
    "values": [
      "global",
      "per-project",
      "per-project-tagged"
    ],
    "default": "per-project",
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Scoping",
      "description": "global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = project-local writes plus global recall visibility",
      "options": [
        {
          "value": "global",
          "label": "Global",
          "description": "One shared Mnemopi bank for every project"
        },
        {
          "value": "per-project",
          "label": "Per project",
          "description": "Project-local Mnemopi bank per cwd basename"
        },
        {
          "value": "per-project-tagged",
          "label": "Per project (tagged)",
          "description": "Write to a project-local bank but merge project + shared recall results"
        }
      ],
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.embeddingVariant",
    "type": "enum",
    "values": [
      "en",
      "multilingual"
    ],
    "default": "en",
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Embedding variant",
      "description": "Local embedding model family. en = stronger English model; multilingual = cross-language model. Changing this rebuilds existing memory embeddings on next start.",
      "options": [
        {
          "value": "en",
          "label": "English (bge-base-en-v1.5)",
          "description": "BAAI/bge-base-en-v1.5 (768d), English-only"
        },
        {
          "value": "multilingual",
          "label": "Multilingual (multilingual-e5-large)",
          "description": "intfloat/multilingual-e5-large (1024d), cross-language recall"
        }
      ],
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.autoRecall",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Auto Recall",
      "description": "Recall local memories into the first turn of each session",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.autoRetain",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Auto Retain",
      "description": "Retain completed conversation turns into local Mnemopi memory",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.polyphonicRecall",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Polyphonic Recall",
      "description": "Enable 4-voice recall (vector, graph, fact, temporal) fused with reciprocal rank fusion",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.enhancedRecall",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Enhanced Recall",
      "description": "Enable the tiered query result cache for repeated and similar recall queries",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.proactiveLinking",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Proactive Linking",
      "description": "Ingest new memories into the episodic graph as they are stored, linking them to related entities and memories",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.noEmbeddings",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Disable Embeddings",
      "description": "Force deterministic FTS-only recall instead of vector embeddings",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.embeddingModel",
    "type": "string",
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Embedding Model",
      "description": "Advanced: explicit embedding model id that overrides the variant. Leave empty to use mnemopi.embeddingVariant.",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.embeddingApiUrl",
    "type": "string",
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Embedding API URL",
      "description": "Optional OpenAI-compatible embedding endpoint passed to Mnemopi",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.embeddingApiKey",
    "type": "string",
    "credential": true,
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi Embedding API Key",
      "description": "Optional embedding API key passed to Mnemopi",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.llmMode",
    "type": "enum",
    "values": [
      "none",
      "smol",
      "remote"
    ],
    "default": "smol",
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi LLM Mode",
      "description": "Use no LLM, the online tiny model (the TINY role from /models, else @smol), or a remote OpenAI-compatible endpoint",
      "condition": "mnemopiActive",
      "options": [
        {
          "value": "none",
          "label": "None",
          "description": "Disable Mnemopi LLM-backed extraction"
        },
        {
          "value": "smol",
          "label": "Online (tiny)",
          "description": "Use the online tiny model (the TINY role from /models, else @smol)"
        },
        {
          "value": "remote",
          "label": "Remote",
          "description": "Use the Mnemopi remote LLM settings below"
        }
      ]
    }
  },
  {
    "key": "mnemopi.llmBaseUrl",
    "type": "string",
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi LLM Base URL",
      "description": "Optional OpenAI-compatible LLM endpoint for Mnemopi remote mode",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.llmApiKey",
    "type": "string",
    "credential": true,
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi LLM API Key",
      "description": "Optional LLM API key for Mnemopi remote mode",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "mnemopi.llmModel",
    "type": "string",
    "ui": {
      "tab": "memory",
      "group": "Mnemopi",
      "label": "Mnemopi LLM Model",
      "description": "Optional LLM model name for Mnemopi remote mode",
      "condition": "mnemopiActive"
    }
  },
  {
    "key": "hindsight.apiUrl",
    "type": "string",
    "default": "http://localhost:8888",
    "ui": {
      "tab": "memory",
      "group": "Hindsight",
      "label": "Hindsight API URL",
      "description": "Hindsight server URL (Cloud or self-hosted)",
      "condition": "hindsightActive"
    }
  },
  {
    "key": "hindsight.apiToken",
    "type": "string",
    "credential": true,
    "ui": {
      "tab": "memory",
      "group": "Hindsight",
      "label": "Hindsight API Token",
      "description": "Bearer token for authenticated Hindsight servers",
      "condition": "hindsightActive"
    }
  },
  {
    "key": "hindsight.bankId",
    "type": "string",
    "ui": {
      "tab": "memory",
      "group": "Hindsight",
      "label": "Hindsight Bank ID",
      "description": "Memory bank identifier (default: project name)",
      "condition": "hindsightActive"
    }
  },
  {
    "key": "hindsight.scoping",
    "type": "enum",
    "values": [
      "global",
      "per-project",
      "per-project-tagged"
    ],
    "default": "per-project-tagged",
    "ui": {
      "tab": "memory",
      "group": "Hindsight",
      "label": "Hindsight Scoping",
      "description": "global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = shared bank with project tags so global + project memories merge on recall",
      "options": [
        {
          "value": "global",
          "label": "Global",
          "description": "One shared bank — every project sees the same memories"
        },
        {
          "value": "per-project",
          "label": "Per project",
          "description": "Isolated bank per cwd basename — projects cannot see each other's memories"
        },
        {
          "value": "per-project-tagged",
          "label": "Per project (tagged)",
          "description": "Shared bank, retains tagged with project:<cwd>. Recall surfaces project + untagged global memories together"
        }
      ],
      "condition": "hindsightActive"
    }
  },
  {
    "key": "hindsight.autoRecall",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "memory",
      "group": "Hindsight",
      "label": "Hindsight Auto Recall",
      "description": "Recall memories on the first turn of each session",
      "condition": "hindsightActive"
    }
  },
  {
    "key": "hindsight.autoRetain",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "memory",
      "group": "Hindsight",
      "label": "Hindsight Auto Retain",
      "description": "Retain transcript every N turns and at session boundaries",
      "condition": "hindsightActive"
    }
  },
  {
    "key": "hindsight.retainMode",
    "type": "enum",
    "values": [
      "full-session",
      "last-turn"
    ],
    "default": "full-session",
    "ui": {
      "tab": "memory",
      "group": "Hindsight",
      "label": "Hindsight Retain Mode",
      "description": "full-session = upsert one document per session, last-turn = chunked",
      "options": [
        {
          "value": "full-session",
          "label": "Full session",
          "description": "Upsert one document per session (recommended)"
        },
        {
          "value": "last-turn",
          "label": "Last turn",
          "description": "Chunked retention sliced by turn boundaries"
        }
      ],
      "condition": "hindsightActive"
    }
  },
  {
    "key": "hindsight.recallBudget",
    "type": "enum",
    "values": [
      "low",
      "mid",
      "high"
    ],
    "default": "mid"
  },
  {
    "key": "hindsight.mentalModelsEnabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "memory",
      "group": "Hindsight",
      "label": "Hindsight Mental Models",
      "description": "Read curated reflect summaries (mental models) into developer instructions at boot. Loads existing models on the bank — does not write. Pair with hindsight.mentalModelAutoSeed to also auto-create the built-in seed set.",
      "condition": "hindsightActive"
    }
  },
  {
    "key": "hindsight.mentalModelAutoSeed",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "memory",
      "group": "Hindsight",
      "label": "Hindsight Mental Model Auto-Seed",
      "description": "At session start, create any built-in mental models (project-conventions, project-decisions, user-preferences) that do not yet exist on the bank.",
      "condition": "hindsightActive"
    }
  },
  {
    "key": "ttsr.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "context",
      "group": "Rules (TTSR)",
      "label": "TTSR",
      "description": "Interrupt the agent mid-stream when output matches rule patterns (Time-Traveling Stream Rules)"
    }
  },
  {
    "key": "ttsr.contextMode",
    "type": "enum",
    "values": [
      "discard",
      "keep"
    ],
    "default": "discard",
    "ui": {
      "tab": "context",
      "group": "Rules (TTSR)",
      "label": "TTSR Context Mode",
      "description": "What to do with partial output when TTSR triggers"
    }
  },
  {
    "key": "ttsr.interruptMode",
    "type": "enum",
    "values": [
      "never",
      "prose-only",
      "tool-only",
      "always"
    ],
    "default": "always",
    "ui": {
      "tab": "context",
      "group": "Rules (TTSR)",
      "label": "TTSR Interrupt Mode",
      "description": "When to interrupt mid-stream vs inject warning after completion",
      "options": [
        {
          "value": "always",
          "label": "always",
          "description": "Interrupt on prose and tool streams"
        },
        {
          "value": "prose-only",
          "label": "prose-only",
          "description": "Interrupt only on reply/thinking matches"
        },
        {
          "value": "tool-only",
          "label": "tool-only",
          "description": "Interrupt only on tool-call argument matches"
        },
        {
          "value": "never",
          "label": "never",
          "description": "Never interrupt; inject warning after completion"
        }
      ]
    }
  },
  {
    "key": "ttsr.repeatMode",
    "type": "enum",
    "values": [
      "once",
      "after-gap"
    ],
    "default": "once",
    "ui": {
      "tab": "context",
      "group": "Rules (TTSR)",
      "label": "TTSR Repeat Mode",
      "description": "How rules can repeat: once per session or after a message gap"
    }
  },
  {
    "key": "ttsr.repeatGap",
    "type": "number",
    "default": 10,
    "ui": {
      "tab": "context",
      "group": "Rules (TTSR)",
      "label": "TTSR Repeat Gap",
      "description": "Messages before a rule can trigger again",
      "options": [
        {
          "value": "5",
          "label": "5 messages"
        },
        {
          "value": "10",
          "label": "10 messages"
        },
        {
          "value": "15",
          "label": "15 messages"
        },
        {
          "value": "20",
          "label": "20 messages"
        },
        {
          "value": "30",
          "label": "30 messages"
        }
      ]
    }
  },
  {
    "key": "ttsr.builtinRules",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "context",
      "group": "Rules (TTSR)",
      "label": "Built-in Rules",
      "description": "Load the default rules shipped with the agent (override individually with ttsr.disabledRules)"
    }
  },
  {
    "key": "ttsr.disabledRules",
    "type": "array",
    "default": [],
    "ui": {
      "tab": "context",
      "group": "Rules (TTSR)",
      "label": "Disabled Rules",
      "description": "Rule names to ignore entirely (applies to bundled defaults and your own rules)"
    }
  },
  {
    "key": "edit.mode",
    "type": "enum",
    "default": "hashline",
    "ui": {
      "tab": "files",
      "group": "Editing",
      "label": "Edit Mode",
      "description": "Select the edit tool variant (replace, patch, hashline, or apply_patch)"
    },
    "values": [
      "replace",
      "patch",
      "hashline",
      "apply_patch"
    ]
  },
  {
    "key": "edit.fuzzyMatch",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "files",
      "group": "Editing",
      "label": "Fuzzy Match",
      "description": "Accept high-confidence fuzzy matches for whitespace differences"
    }
  },
  {
    "key": "edit.fuzzyThreshold",
    "type": "number",
    "default": 0.95,
    "ui": {
      "tab": "files",
      "group": "Editing",
      "label": "Fuzzy Match Threshold",
      "description": "Similarity threshold (0-1) for accepting fuzzy matches",
      "options": [
        {
          "value": "0.85",
          "label": "0.85",
          "description": "Lenient"
        },
        {
          "value": "0.90",
          "label": "0.90",
          "description": "Moderate"
        },
        {
          "value": "0.95",
          "label": "0.95",
          "description": "Default"
        },
        {
          "value": "0.98",
          "label": "0.98",
          "description": "Strict"
        }
      ]
    }
  },
  {
    "key": "edit.streamingAbort",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "files",
      "group": "Editing",
      "label": "Abort on Failed Preview",
      "description": "Abort streaming edit tool calls when patch preview fails"
    }
  },
  {
    "key": "edit.blockAutoGenerated",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "files",
      "group": "Editing",
      "label": "Block Auto-Generated Files",
      "description": "Prevent editing of files that appear to be auto-generated (protoc, sqlc, swagger, etc.)"
    }
  },
  {
    "key": "edit.enforceSeenLines",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "files",
      "group": "Editing",
      "label": "Enforce Seen-Line Guard",
      "description": "Reject edits anchored on lines a prior read/search never displayed in full"
    }
  },
  {
    "key": "readLineNumbers",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "files",
      "group": "Reading",
      "label": "Line Numbers",
      "description": "Prepend line numbers to read tool output by default"
    }
  },
  {
    "key": "read.defaultLimit",
    "type": "number",
    "default": 300,
    "ui": {
      "tab": "files",
      "group": "Reading",
      "label": "Default Read Limit",
      "description": "Default number of lines returned when agent calls read without a limit",
      "options": [
        {
          "value": "200",
          "label": "200 lines"
        },
        {
          "value": "300",
          "label": "300 lines"
        },
        {
          "value": "500",
          "label": "500 lines"
        },
        {
          "value": "1000",
          "label": "1000 lines"
        },
        {
          "value": "5000",
          "label": "5000 lines"
        }
      ]
    }
  },
  {
    "key": "read.renderMarkdown",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "files",
      "group": "Reading",
      "label": "Markdown Previews",
      "description": "Render Markdown read results as formatted terminal Markdown previews instead of raw source"
    }
  },
  {
    "key": "read.summarize.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "files",
      "group": "Read Summaries",
      "label": "Read Summaries",
      "description": "Return structural code summaries when read is called without an explicit selector"
    }
  },
  {
    "key": "read.summarize.prose",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "files",
      "group": "Read Summaries",
      "label": "Prose Summaries",
      "description": "Return structural summaries for Markdown and plain text reads"
    }
  },
  {
    "key": "read.summarize.minBodyLines",
    "type": "number",
    "default": 4,
    "ui": {
      "tab": "files",
      "group": "Read Summaries",
      "label": "Read Summary Body Lines",
      "description": "Minimum multiline body or literal length before read summaries collapse it"
    }
  },
  {
    "key": "read.summarize.minCommentLines",
    "type": "number",
    "default": 6,
    "ui": {
      "tab": "files",
      "group": "Read Summaries",
      "label": "Read Summary Comment Lines",
      "description": "Minimum multiline block comment length before read summaries collapse it"
    }
  },
  {
    "key": "read.summarize.minTotalLines",
    "type": "number",
    "default": 100,
    "ui": {
      "tab": "files",
      "group": "Read Summaries",
      "label": "Read Summary Minimum File Length",
      "description": "Files with fewer total lines are read verbatim instead of structurally summarized"
    }
  },
  {
    "key": "read.summarize.unfoldUntil",
    "type": "number",
    "default": 50,
    "ui": {
      "tab": "files",
      "group": "Read Summaries",
      "label": "Read Summary Unfold Target",
      "description": "BFS-unfold elidable spans until the summary is at least this many visible lines. 0 keeps only the outermost elisions."
    }
  },
  {
    "key": "read.summarize.unfoldLimit",
    "type": "number",
    "default": 100,
    "ui": {
      "tab": "files",
      "group": "Read Summaries",
      "label": "Read Summary Unfold Ceiling",
      "description": "Hard ceiling on summary size while BFS-unfolding. An unfold whose revealed lines would exceed this is skipped (that span stays folded) and unfolding continues with the remaining spans."
    }
  },
  {
    "key": "read.toolResultPreview",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "files",
      "group": "Reading",
      "label": "Inline Read Previews",
      "description": "Render read tool results inline in the transcript instead of summary rows"
    }
  },
  {
    "key": "lsp.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "files",
      "group": "LSP",
      "label": "LSP",
      "description": "Enable the lsp tool for code intelligence (definitions, references, diagnostics, rename)"
    }
  },
  {
    "key": "lsp.lazy",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "files",
      "group": "LSP",
      "label": "Lazy LSP Startup",
      "description": "Start language servers on first use (lsp tool or editing a matching file type) instead of at session startup"
    }
  },
  {
    "key": "lsp.shared",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "files",
      "group": "LSP",
      "label": "Shared Language Servers",
      "description": "Share one language server per project across omp instances via the daemon broker (falls back to private servers when unavailable)"
    }
  },
  {
    "key": "lsp.formatOnWrite",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "files",
      "group": "LSP",
      "label": "Format on Write",
      "description": "Automatically format code files using LSP after writing"
    }
  },
  {
    "key": "lsp.diagnosticsOnWrite",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "files",
      "group": "LSP",
      "label": "Diagnostics on Write",
      "description": "Return LSP diagnostics after writing code files"
    }
  },
  {
    "key": "lsp.diagnosticsOnEdit",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "files",
      "group": "LSP",
      "label": "Diagnostics on Edit",
      "description": "Return LSP diagnostics after editing code files"
    }
  },
  {
    "key": "lsp.diagnosticsDeduplicate",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "files",
      "group": "LSP",
      "label": "Deduplicate Diagnostics",
      "description": "Suppress post-edit LSP diagnostics already shown for a file; only surface new or changed ones"
    }
  },
  {
    "key": "bash.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "shell",
      "group": "Bash",
      "label": "Bash",
      "description": "Enable the bash tool for shell command execution"
    }
  },
  {
    "key": "bash.autoBackground.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "shell",
      "group": "Bash",
      "label": "Bash Auto-Background",
      "description": "Automatically background long-running bash commands and deliver the result later"
    }
  },
  {
    "key": "bash.patterns",
    "type": "array",
    "default": [],
    "ui": {
      "tab": "shell",
      "group": "Bash",
      "label": "Bash Approval Patterns",
      "description": "Ordered bash command approval rules. Each item has match and approval fields; only '*' wildcards are supported."
    }
  },
  {
    "key": "bashInterceptor.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "shell",
      "group": "Bash",
      "label": "Bash Interceptor",
      "description": "Block shell commands that have dedicated tools"
    }
  },
  {
    "key": "bash.direnv",
    "type": "enum",
    "values": [
      "auto",
      "off"
    ],
    "default": "auto",
    "ui": {
      "tab": "shell",
      "group": "Bash",
      "label": "direnv Auto-Load",
      "description": "Auto-load a repo's direnv/devenv `.envrc` into the bash session so devenv tools and env vars are present without manual `direnv exec`. Honors direnv's allow list: an `.envrc` you haven't `direnv allow`ed is never executed"
    }
  },
  {
    "key": "bash.direnvLoadTimeoutMs",
    "type": "number",
    "default": 30000,
    "ui": {
      "tab": "shell",
      "group": "Bash",
      "label": "direnv Load Timeout (ms)",
      "description": "Max wait for the first `direnv export` (a cold devenv shell can be slow); on timeout the session runs without the direnv env"
    }
  },
  {
    "key": "shellMinimizer.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "shell",
      "group": "Bash",
      "label": "Shell Minimizer",
      "description": "Compress verbose shell output (git, npm, cargo, etc.) before returning it to the agent"
    }
  },
  {
    "key": "shellMinimizer.settingsPath",
    "type": "string"
  },
  {
    "key": "shellMinimizer.maxCaptureBytes",
    "type": "number",
    "default": 4194304
  },
  {
    "key": "shellMinimizer.sourceOutlineLevel",
    "type": "enum",
    "values": [
      "default",
      "aggressive"
    ],
    "default": "default",
    "ui": {
      "tab": "shell",
      "group": "Bash",
      "label": "Shell Minimizer Source Outline",
      "description": "Source outline mode for cat/read of source files: default or aggressive"
    }
  },
  {
    "key": "shellMinimizer.legacyFilters",
    "type": "boolean"
  },
  {
    "key": "eval.py",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "shell",
      "group": "Eval & Runtimes",
      "label": "Python Eval Backend",
      "description": "Allow the eval tool to dispatch Python cells to the IPython kernel"
    }
  },
  {
    "key": "eval.js",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "shell",
      "group": "Eval & Runtimes",
      "label": "JavaScript Eval Backend",
      "description": "Allow the eval tool to dispatch JavaScript cells to the in-process runtime"
    }
  },
  {
    "key": "eval.rb",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "shell",
      "group": "Eval & Runtimes",
      "label": "Ruby Eval Backend",
      "description": "Allow the eval tool to dispatch Ruby cells to the persistent Ruby kernel"
    }
  },
  {
    "key": "eval.jl",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "shell",
      "group": "Eval & Runtimes",
      "label": "Julia Eval Backend",
      "description": "Allow the eval tool to dispatch Julia cells to the persistent Julia kernel"
    }
  },
  {
    "key": "python.kernelMode",
    "type": "enum",
    "values": [
      "session",
      "per-call"
    ],
    "default": "session",
    "ui": {
      "tab": "shell",
      "group": "Eval & Runtimes",
      "label": "Python Kernel Mode",
      "description": "Keep the IPython kernel alive across eval calls or start fresh each time"
    }
  },
  {
    "key": "python.interpreter",
    "type": "string",
    "default": "",
    "ui": {
      "tab": "shell",
      "group": "Eval & Runtimes",
      "label": "Python Interpreter",
      "description": "Optional path to an exact Python executable. When set, automatic Python runtime discovery is skipped."
    }
  },
  {
    "key": "ruby.interpreter",
    "type": "string",
    "default": "",
    "ui": {
      "tab": "shell",
      "group": "Eval & Runtimes",
      "label": "Ruby Interpreter",
      "description": "Optional path to an exact Ruby executable. When set, automatic Ruby runtime discovery is skipped."
    }
  },
  {
    "key": "julia.interpreter",
    "type": "string",
    "default": "",
    "ui": {
      "tab": "shell",
      "group": "Eval & Runtimes",
      "label": "Julia Interpreter",
      "description": "Optional path to an exact Julia executable. When set, automatic Julia runtime discovery is skipped."
    }
  },
  {
    "key": "tools.approval",
    "type": "record",
    "default": {},
    "ui": {
      "tab": "interaction",
      "group": "Approvals",
      "label": "Tool Approval Policies",
      "description": "Per-tool approval policies. Set to 'allow' to auto-approve, 'prompt' to require confirmation, or 'deny' to block. Overrides are honored in every approval mode."
    }
  },
  {
    "key": "tools.approvalMode",
    "type": "enum",
    "values": [
      "always-ask",
      "write",
      "yolo"
    ],
    "default": "yolo",
    "ui": {
      "tab": "interaction",
      "group": "Approvals",
      "label": "Tool Approval",
      "description": "Default approval behavior for tool calls. 'Always ask' auto-approves read-only tools only. 'Write' auto-approves read and workspace-write tools. 'Yolo' auto-approves all tiers; user policy may still prompt or block.",
      "options": [
        {
          "value": "always-ask",
          "label": "Always ask",
          "description": "Auto-approve read-only tools; require confirmation for write and exec tools."
        },
        {
          "value": "write",
          "label": "Write",
          "description": "Auto-approve read-only and write tools; require confirmation for exec tools such as bash, eval, browser, and task."
        },
        {
          "value": "yolo",
          "label": "Yolo",
          "description": "Auto-approve read, write, and exec tools. User policy can still require confirmation or block calls."
        }
      ]
    }
  },
  {
    "key": "todo.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Todos",
      "description": "Enable the todo tool for task tracking"
    }
  },
  {
    "key": "todo.reminders",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Todos",
      "label": "Todo Reminders",
      "description": "Remind the agent to complete todos before stopping"
    }
  },
  {
    "key": "todo.remindersMax",
    "type": "number",
    "default": 3,
    "ui": {
      "tab": "tools",
      "group": "Todos",
      "label": "Todo Reminder Limit",
      "description": "Maximum number of todo reminders before giving up",
      "options": [
        {
          "value": "1",
          "label": "1 reminder"
        },
        {
          "value": "2",
          "label": "2 reminders"
        },
        {
          "value": "3",
          "label": "3 reminders"
        },
        {
          "value": "5",
          "label": "5 reminders"
        }
      ]
    }
  },
  {
    "key": "todo.eager",
    "type": "enum",
    "values": [
      "default",
      "preferred",
      "always"
    ],
    "default": "default",
    "ui": {
      "tab": "tools",
      "group": "Todos",
      "label": "Create Todos Automatically",
      "description": "How strongly to push automatic todo-list creation after the first message",
      "options": [
        {
          "value": "default",
          "label": "Default",
          "description": "Model decides; no automatic todo list"
        },
        {
          "value": "preferred",
          "label": "Preferred",
          "description": "Suggests a todo list on the first message (reminder, not forced)"
        },
        {
          "value": "always",
          "label": "Always",
          "description": "Forces a comprehensive todo list on the first message"
        }
      ]
    }
  },
  {
    "key": "glob.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Glob",
      "description": "Enable the glob tool for glob-based file lookup"
    }
  },
  {
    "key": "grep.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Grep",
      "description": "Enable the grep tool for regex content search"
    }
  },
  {
    "key": "grep.contextBefore",
    "type": "number",
    "default": 1,
    "ui": {
      "tab": "tools",
      "group": "Grep & Browser",
      "label": "Grep Context Before",
      "description": "Lines of context before each grep match",
      "options": [
        {
          "value": "0",
          "label": "0 lines"
        },
        {
          "value": "1",
          "label": "1 line"
        },
        {
          "value": "2",
          "label": "2 lines"
        },
        {
          "value": "3",
          "label": "3 lines"
        },
        {
          "value": "5",
          "label": "5 lines"
        }
      ]
    }
  },
  {
    "key": "grep.contextAfter",
    "type": "number",
    "default": 3,
    "ui": {
      "tab": "tools",
      "group": "Grep & Browser",
      "label": "Grep Context After",
      "description": "Lines of context after each grep match",
      "options": [
        {
          "value": "0",
          "label": "0 lines"
        },
        {
          "value": "1",
          "label": "1 line"
        },
        {
          "value": "2",
          "label": "2 lines"
        },
        {
          "value": "3",
          "label": "3 lines"
        },
        {
          "value": "5",
          "label": "5 lines"
        },
        {
          "value": "10",
          "label": "10 lines"
        }
      ]
    }
  },
  {
    "key": "astGrep.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "AST Grep",
      "description": "Enable the ast_grep tool for structural AST search"
    }
  },
  {
    "key": "astEdit.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "AST Edit",
      "description": "Enable the ast_edit tool for structural AST rewrites"
    }
  },
  {
    "key": "debug.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Debug",
      "description": "Enable the debug tool for DAP-based debugging"
    }
  },
  {
    "key": "launch.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Launch",
      "description": "Enable the launch tool for supervising shared long-running project processes"
    }
  },
  {
    "key": "speechgen.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Speech Generation",
      "description": "Enable the tts tool for on-device (Kokoro) or xAI Grok Voice speech-file synthesis"
    }
  },
  {
    "key": "generate_image.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Generate Image",
      "description": "Enable the generate_image tool (text-to-image generation and editing). Exposed as an xd:// device when tools.xdev is on."
    }
  },
  {
    "key": "inspect_image.enabled",
    "type": "boolean",
    "default": false
  },
  {
    "key": "inspect_image.mode",
    "type": "enum",
    "values": [
      "auto",
      "on",
      "off"
    ],
    "default": "auto",
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Inspect Image",
      "description": "Controls the inspect_image tool, which delegates image understanding to a vision-capable model. 'auto' exposes it only when the active model lacks native image input; 'on' always exposes it; 'off' never does.",
      "options": [
        {
          "value": "auto",
          "label": "Auto (only for models without vision)"
        },
        {
          "value": "on",
          "label": "On"
        },
        {
          "value": "off",
          "label": "Off"
        }
      ]
    }
  },
  {
    "key": "computer.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Computer",
      "description": "Enable the scriptable host-desktop control tool (screenshots, input, accessibility)"
    }
  },
  {
    "key": "computer.display",
    "type": "string",
    "default": "all",
    "ui": {
      "tab": "tools",
      "group": "Computer",
      "label": "Computer Display",
      "description": "Composite all displays or select a native display id"
    }
  },
  {
    "key": "computer.maxWidth",
    "type": "number",
    "default": 3840,
    "ui": {
      "tab": "tools",
      "group": "Computer",
      "label": "Computer Screenshot Width",
      "description": "Maximum composite screenshot width in pixels"
    }
  },
  {
    "key": "computer.maxHeight",
    "type": "number",
    "default": 2400,
    "ui": {
      "tab": "tools",
      "group": "Computer",
      "label": "Computer Screenshot Height",
      "description": "Maximum composite screenshot height in pixels"
    }
  },
  {
    "key": "inspect_image.timeoutMs",
    "type": "number",
    "default": 300000,
    "ui": {
      "tab": "tools",
      "group": "Execution",
      "label": "Inspect Image Timeout",
      "description": "Per-request timeout for the inspect_image vision-model call, in milliseconds. A stalled provider fails fast with a timeout error instead of blocking until manual abort. Set to 0 to disable the timeout.",
      "options": [
        {
          "value": "0",
          "label": "Disabled"
        },
        {
          "value": "60000",
          "label": "1 minute"
        },
        {
          "value": "120000",
          "label": "2 minutes"
        },
        {
          "value": "180000",
          "label": "3 minutes"
        },
        {
          "value": "300000",
          "label": "5 minutes"
        }
      ]
    }
  },
  {
    "key": "checkpoint.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Checkpoint/Rewind",
      "description": "Enable the checkpoint and rewind tools for context checkpointing"
    }
  },
  {
    "key": "fetch.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Read URLs",
      "description": "Allow the read tool to fetch and process URLs"
    }
  },
  {
    "key": "vault.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Obsidian Vault",
      "description": "Enable the vault:// internal URL for reading and editing Obsidian vault content via the Obsidian CLI. When disabled, vault:// resolution is refused and the vault:// entry is omitted from the system prompt."
    }
  },
  {
    "key": "github.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "GitHub CLI",
      "description": "Enable the github tool (op-based dispatch for repository, issue, pull request, diff, search, checkout, push, and Actions watch workflows)"
    }
  },
  {
    "key": "github.cache.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "GitHub",
      "label": "GitHub View Cache",
      "description": "Cache rendered issue/PR view output in ~/.omp/cache/github-cache.db so repeated reads are free"
    }
  },
  {
    "key": "github.cache.softTtlSec",
    "type": "number",
    "default": 300,
    "ui": {
      "tab": "tools",
      "group": "GitHub",
      "label": "GitHub Cache Soft TTL",
      "description": "Within this window, cached issue/PR view rows are returned directly (seconds; default 5 minutes)"
    }
  },
  {
    "key": "github.cache.hardTtlSec",
    "type": "number",
    "default": 604800,
    "ui": {
      "tab": "tools",
      "group": "GitHub",
      "label": "GitHub Cache Hard TTL",
      "description": "Past the soft TTL the cached row is returned and refreshed in the background; past the hard TTL it is dropped (seconds; default 7 days)"
    }
  },
  {
    "key": "web_search.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Web Search",
      "description": "Enable the web_search tool for live web results"
    }
  },
  {
    "key": "security.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Security",
      "description": "Enable OMP-native security scan planning, execution, and the read-only security:// resource namespace"
    }
  },
  {
    "key": "ask.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Ask",
      "description": "Enable the ask tool for interactive user questions"
    }
  },
  {
    "key": "browser.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Available Tools",
      "label": "Browser",
      "description": "Enable the browser tool for scripted Chromium automation (puppeteer)"
    }
  },
  {
    "key": "browser.cdpUrl",
    "type": "string",
    "ui": {
      "tab": "tools",
      "group": "Grep & Browser",
      "label": "Browser CDP URL",
      "description": "Default HTTP CDP discovery endpoint (for example http://127.0.0.1:9222) to attach to instead of launching a browser. Explicit app.cdp_url or app.path on the tool call take precedence."
    }
  },
  {
    "key": "browser.relay",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Grep & Browser",
      "label": "Browser Relay",
      "description": "Drive your own Chrome tabs through the omp browser relay. Install the extension once (`omp browser-relay install`); the relay server auto-starts when the browser tool needs it. Takes precedence over Browser CDP URL; set PI_BROWSER_RELAY=0 or PI_BROWSER_RELAY=1 to override."
    }
  },
  {
    "key": "browser.relayUrl",
    "type": "string",
    "ui": {
      "tab": "tools",
      "group": "Grep & Browser",
      "label": "Browser Relay URL",
      "description": "omp browser relay endpoint (default http://127.0.0.1:9224)."
    }
  },
  {
    "key": "browser.headless",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Grep & Browser",
      "label": "Headless Browser",
      "description": "Launch browser in headless mode (disable to show browser UI)"
    }
  },
  {
    "key": "browser.cmux",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Grep & Browser",
      "label": "cmux Browser",
      "description": "Use cmux WKWebView surfaces for browser automation when a cmux socket is available. Set PI_BROWSER_CMUX=0 or PI_BROWSER_CMUX=1 to override."
    }
  },
  {
    "key": "browser.screenshotDir",
    "type": "string",
    "ui": {
      "tab": "tools",
      "group": "Grep & Browser",
      "label": "Screenshot Directory",
      "description": "Directory to save screenshots. If unset, screenshots go to a temp file. Supports ~. Examples: ~/Downloads, ~/Desktop, /sdcard/Download (Android)"
    }
  },
  {
    "key": "tools.intentTracing",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Execution",
      "label": "Intent Tracing",
      "description": "Ask the agent to describe the intent of each tool call before executing it"
    }
  },
  {
    "key": "tools.abortOnFabricatedResult",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Execution",
      "label": "Abort On Fabricated Tool Result",
      "description": "With in-band tool calls, stop the model immediately when it starts hallucinating a tool result mid-turn. Disable to let the model finish generating and discard the fabricated continuation instead."
    }
  },
  {
    "key": "tools.maxTimeout",
    "type": "number",
    "default": 0,
    "ui": {
      "tab": "tools",
      "group": "Execution",
      "label": "Max Tool Timeout",
      "description": "Maximum timeout in seconds the agent can set for any tool (0 = no limit)",
      "options": [
        {
          "value": "0",
          "label": "No limit"
        },
        {
          "value": "30",
          "label": "30 seconds"
        },
        {
          "value": "60",
          "label": "60 seconds"
        },
        {
          "value": "120",
          "label": "120 seconds"
        },
        {
          "value": "300",
          "label": "5 minutes"
        },
        {
          "value": "600",
          "label": "10 minutes"
        }
      ]
    }
  },
  {
    "key": "async.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Execution",
      "label": "Async Execution",
      "description": "Enable async bash commands and background task execution"
    }
  },
  {
    "key": "async.maxJobs",
    "type": "number",
    "default": 100
  },
  {
    "key": "async.pollWaitDuration",
    "type": "enum",
    "values": [
      "5s",
      "10s",
      "30s",
      "1m",
      "5m",
      "smart"
    ],
    "default": "smart",
    "ui": {
      "tab": "tools",
      "group": "Execution",
      "label": "Max Poll Time",
      "description": "How long a `hub` wait watches background jobs before returning the current state. A fixed value waits that exact duration every time. `smart` adapts: it starts at 5s and lengthens with each back-to-back wait (up to 5m), then resets to 5s after about a minute without waiting.",
      "options": [
        {
          "value": "5s",
          "label": "5 seconds"
        },
        {
          "value": "10s",
          "label": "10 seconds"
        },
        {
          "value": "30s",
          "label": "30 seconds"
        },
        {
          "value": "1m",
          "label": "1 minute"
        },
        {
          "value": "5m",
          "label": "5 minutes"
        },
        {
          "value": "smart",
          "label": "Smart",
          "description": "Default — adaptive 5s→5m, resets when you stop polling"
        }
      ]
    }
  },
  {
    "key": "irc.timeoutMs",
    "type": "number",
    "default": 120000,
    "ui": {
      "tab": "tools",
      "group": "Execution",
      "label": "IRC Timeout",
      "description": "Default timeout for hub message waits (and send await:true) in milliseconds; 0 disables the timeout",
      "options": [
        {
          "value": "0",
          "label": "Disabled"
        },
        {
          "value": "30000",
          "label": "30 seconds"
        },
        {
          "value": "60000",
          "label": "1 minute"
        },
        {
          "value": "120000",
          "label": "2 minutes"
        },
        {
          "value": "300000",
          "label": "5 minutes"
        }
      ]
    }
  },
  {
    "key": "bash.autoBackground.thresholdMs",
    "type": "number",
    "default": 60000
  },
  {
    "key": "tools.xdev",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Discovery & MCP",
      "label": "xd:// Tools",
      "description": "Mount rarely-used (discoverable) tools under xd:// device URLs driven via read/write instead of shipping their schemas on every request. Sessions without a granted write tool skip mounting and expose every tool top-level. Disable to expose every enabled tool top-level."
    }
  },
  {
    "key": "tools.xdevDocs",
    "type": "enum",
    "values": [
      "inline",
      "builtins",
      "catalog"
    ],
    "default": "builtins",
    "ui": {
      "tab": "tools",
      "group": "Discovery & MCP",
      "label": "xd:// Prompt Docs",
      "description": "Choose which mounted-device docs and schemas are inlined in the system prompt. Built-ins keeps core tools inline while MCP and extension tools stay on-demand.",
      "options": [
        {
          "value": "inline",
          "label": "All Devices",
          "description": "Inline docs and schemas for every mounted device."
        },
        {
          "value": "builtins",
          "label": "Built-ins Only",
          "description": "Inline built-in docs; fetch MCP and extension docs on demand."
        },
        {
          "value": "catalog",
          "label": "Catalog Only",
          "description": "List every device; fetch all docs on demand."
        }
      ]
    }
  },
  {
    "key": "tools.xdevInlineDevices",
    "type": "array",
    "default": {},
    "ui": {
      "tab": "tools",
      "group": "Discovery & MCP",
      "label": "xd:// Inline Devices",
      "description": "When xd:// Prompt Docs is Built-ins Only, inline dynamic devices whose names match these glob patterns (for example mcp__context_mode_*). Catalog Only ignores this setting."
    }
  },
  {
    "key": "mcp.enableProjectConfig",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Discovery & MCP",
      "label": "MCP Project Config",
      "description": "Load .mcp.json/mcp.json from project root"
    }
  },
  {
    "key": "mcp.renderMarkdownResults",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Discovery & MCP",
      "label": "MCP Markdown Results",
      "description": "Render non-JSON MCP text results as Markdown in the transcript"
    }
  },
  {
    "key": "mcp.notifications",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tools",
      "group": "Discovery & MCP",
      "label": "MCP Update Injection",
      "description": "Inject MCP resource updates into the agent conversation"
    }
  },
  {
    "key": "mcp.notificationDebounceMs",
    "type": "number",
    "default": 500,
    "ui": {
      "tab": "tools",
      "group": "Discovery & MCP",
      "label": "MCP Notification Debounce",
      "description": "Debounce window in milliseconds for MCP resource updates before injecting them into the conversation"
    }
  },
  {
    "key": "plan.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Modes",
      "label": "Plan Mode",
      "description": "Enable plan mode for read-only exploration and planning before execution"
    }
  },
  {
    "key": "plan.defaultOnStartup",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tasks",
      "group": "Modes",
      "label": "Start in Plan Mode",
      "description": "Automatically enter plan mode at the start of every new session",
      "condition": "planModeEnabled"
    }
  },
  {
    "key": "goal.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Modes",
      "label": "Goal Mode",
      "description": "Enable per-session goal mode and the hidden goal tool"
    }
  },
  {
    "key": "goal.statusInFooter",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Modes",
      "label": "Goal Status in Footer",
      "description": "Show token budget alongside the goal indicator in the status line"
    }
  },
  {
    "key": "goal.continuationModes",
    "type": "array",
    "default": [
      "interactive"
    ],
    "ui": {
      "tab": "tasks",
      "group": "Modes",
      "label": "Goal Continuation Modes",
      "description": "Run modes where active goals may auto-continue between turns"
    }
  },
  {
    "key": "title.refreshOnReplan",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Modes",
      "label": "Refresh Title on Replan",
      "description": "Refresh generated session titles after todo init replans unless the title was set by the user"
    }
  },
  {
    "key": "task.isolation.mode",
    "type": "enum",
    "values": [
      "none",
      "auto",
      "apfs",
      "btrfs",
      "zfs",
      "reflink",
      "overlayfs",
      "projfs",
      "block-clone",
      "rcopy"
    ],
    "default": "none",
    "ui": {
      "tab": "tasks",
      "group": "Isolation",
      "label": "Isolation Mode",
      "description": "Isolation backend for subagents. \"auto\" lets the native PAL pick the best available backend (CoW-aware filesystems, then overlayfs/ProjFS, then a git worktree / recursive-copy fallback).",
      "options": [
        {
          "value": "none",
          "label": "None",
          "description": "No isolation"
        },
        {
          "value": "auto",
          "label": "Auto",
          "description": "Let the PAL pick the best available backend"
        },
        {
          "value": "apfs",
          "label": "APFS",
          "description": "macOS clonefile reflink (APFS)"
        },
        {
          "value": "btrfs",
          "label": "btrfs",
          "description": "btrfs subvolume snapshot"
        },
        {
          "value": "zfs",
          "label": "ZFS",
          "description": "ZFS snapshot + clone"
        },
        {
          "value": "reflink",
          "label": "Reflink",
          "description": "Linux FICLONE per-file reflink"
        },
        {
          "value": "overlayfs",
          "label": "Overlayfs",
          "description": "Linux kernel overlay (or fuse-overlayfs fallback)"
        },
        {
          "value": "projfs",
          "label": "ProjFS",
          "description": "Windows Projected File System"
        },
        {
          "value": "block-clone",
          "label": "Block clone",
          "description": "Windows FSCTL_DUPLICATE_EXTENTS_TO_FILE (NTFS/ReFS)"
        },
        {
          "value": "rcopy",
          "label": "Recursive copy",
          "description": "git worktree if available, otherwise recursive copy"
        }
      ]
    }
  },
  {
    "key": "task.isolation.apply",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Isolation",
      "label": "Apply Isolated Changes",
      "description": "Automatically apply successful isolated task changes to the parent checkout; disable to retain patch or branch artifacts"
    }
  },
  {
    "key": "task.isolation.merge",
    "type": "enum",
    "values": [
      "patch",
      "branch"
    ],
    "default": "patch",
    "ui": {
      "tab": "tasks",
      "group": "Isolation",
      "label": "Isolation Merge Strategy",
      "description": "How isolated task changes are integrated (patch apply or branch merge)",
      "options": [
        {
          "value": "patch",
          "label": "Patch",
          "description": "Combine diffs and git apply"
        },
        {
          "value": "branch",
          "label": "Branch",
          "description": "Commit per task, merge with --no-ff"
        }
      ]
    }
  },
  {
    "key": "task.isolation.commits",
    "type": "enum",
    "values": [
      "generic",
      "ai"
    ],
    "default": "generic",
    "ui": {
      "tab": "tasks",
      "group": "Isolation",
      "label": "Isolation Commit Style",
      "description": "Commit message style for nested repo changes (generic or AI-generated)",
      "options": [
        {
          "value": "generic",
          "label": "Generic",
          "description": "Static commit message"
        },
        {
          "value": "ai",
          "label": "AI",
          "description": "AI-generated commit message from diff"
        }
      ]
    }
  },
  {
    "key": "worktree.base",
    "type": "string",
    "ui": {
      "tab": "tasks",
      "group": "Isolation",
      "label": "Worktree Base Directory",
      "description": "Base directory for agent-managed worktrees — task-isolation copies, `github` PR checkouts, and `omp worktree` cleanup all live here. Unset uses ~/.omp/wt. Must be an absolute or ~-relative path; relative paths are ignored. The OMP_WORKTREE_DIR env var overrides this."
    }
  },
  {
    "key": "task.eager",
    "type": "enum",
    "values": [
      "default",
      "preferred",
      "always"
    ],
    "default": "default",
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Prefer Task Delegation",
      "description": "How strongly to push delegating work to subagents",
      "options": [
        {
          "value": "default",
          "label": "Default",
          "description": "Model decides when to delegate"
        },
        {
          "value": "preferred",
          "label": "Preferred",
          "description": "Adds delegation guidance to the system prompt"
        },
        {
          "value": "always",
          "label": "Always",
          "description": "Prompt guidance plus a first-turn delegation reminder"
        }
      ]
    }
  },
  {
    "key": "task.batch",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Batch Task Calls",
      "description": "Switch the task tool to its batch shape: one call carries { context, tasks[] } — one subagent per item, with an optional per-item agent (defaulting to the session spawn-policy agent), per-item isolation, and a required shared context prepended to every assignment. With async.enabled=true, each spawn runs as an independent background agent with the normal idle/parked lifecycle; otherwise the call blocks for merged results. Disable to restore the flat single-spawn schema."
    }
  },
  {
    "key": "task.enableEffort",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Per-Task Effort",
      "description": "Expose the optional effort parameter on task spawns, allowing callers to override each subagent's thinking level"
    }
  },
  {
    "key": "task.maxConcurrency",
    "type": "number",
    "default": 32,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Max Concurrent Tasks",
      "description": "Maximum number of subagents running concurrently",
      "options": [
        {
          "value": "0",
          "label": "Unlimited"
        },
        {
          "value": "1",
          "label": "1 task"
        },
        {
          "value": "2",
          "label": "2 tasks"
        },
        {
          "value": "4",
          "label": "4 tasks"
        },
        {
          "value": "8",
          "label": "8 tasks"
        },
        {
          "value": "16",
          "label": "16 tasks"
        },
        {
          "value": "32",
          "label": "32 tasks"
        },
        {
          "value": "64",
          "label": "64 tasks"
        }
      ]
    }
  },
  {
    "key": "task.enableLsp",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "LSP in Subagents",
      "description": "Allow subagents spawned via the task tool to use the lsp tool. Off by default to keep subagents cheap; enable when LSP-aware delegation is worth the extra tokens."
    }
  },
  {
    "key": "task.maxRecursionDepth",
    "type": "number",
    "default": 2,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Max Task Recursion",
      "description": "How many levels deep subagents can spawn their own subagents",
      "options": [
        {
          "value": "-1",
          "label": "Unlimited"
        },
        {
          "value": "0",
          "label": "None"
        },
        {
          "value": "1",
          "label": "Single"
        },
        {
          "value": "2",
          "label": "Double"
        },
        {
          "value": "3",
          "label": "Triple"
        }
      ]
    }
  },
  {
    "key": "task.maxRuntimeMs",
    "type": "number",
    "default": 0,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Max Subagent Runtime",
      "description": "Hard wall-clock limit per subagent (ms). 0 disables it. Defense-in-depth against provider-side stream hangs that escape the inference-layer watchdog; triggers a normal subagent abort with a 'timed out' reason.",
      "options": [
        {
          "value": "0",
          "label": "Unlimited",
          "description": "Default"
        },
        {
          "value": "300000",
          "label": "5 minutes"
        },
        {
          "value": "900000",
          "label": "15 minutes"
        },
        {
          "value": "1800000",
          "label": "30 minutes"
        },
        {
          "value": "3600000",
          "label": "1 hour"
        }
      ]
    }
  },
  {
    "key": "task.agentIdleTtlMs",
    "type": "number",
    "default": 420000,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Agent Idle TTL",
      "description": "How long an idle subagent stays live in memory before being parked to disk (ms). Parked agents are revived automatically when messaged or resumed. 0 keeps idle agents live until exit."
    }
  },
  {
    "key": "task.softRequestBudget",
    "type": "number",
    "default": 200,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Soft Subagent Request Budget",
      "description": "Soft per-subagent request budget (assistant requests per run). Crossing it injects a wrap-up steering notice (see task.softRequestBudgetNotice); at 1.5x the budget the run is force-stopped and the agent must yield its partial findings. 0 disables the guard. Bundled scout/sonic agents cap out at a lower built-in budget, so a value below that cap still applies to them.",
      "options": [
        {
          "value": "0",
          "label": "Disabled"
        },
        {
          "value": "90",
          "label": "90 requests"
        },
        {
          "value": "150",
          "label": "150 requests"
        },
        {
          "value": "200",
          "label": "200 requests",
          "description": "Default"
        }
      ]
    }
  },
  {
    "key": "task.softRequestBudgetNotice",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Soft Request Budget Notice",
      "description": "Inject one steering notice when a subagent crosses its soft request budget, asking it to wrap up before the 1.5x forced-yield stop."
    }
  },
  {
    "key": "task.maxEffort",
    "type": "enum",
    "default": "max",
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Maximum Per-Spawn Effort",
      "description": "Maximum reasoning effort allowed for the task tool's per-spawn effort hint. Lower values prevent callers from escalating subagents above this ceiling; the default preserves the model's full range."
    },
    "values": [
      "min",
      "low",
      "medium",
      "high",
      "max"
    ]
  },
  {
    "key": "task.disabledAgents",
    "type": "array",
    "default": []
  },
  {
    "key": "task.agentModelOverrides",
    "type": "record",
    "default": {}
  },
  {
    "key": "task.agentPrewalk",
    "type": "record",
    "default": {}
  },
  {
    "key": "task.agentAdvisor",
    "type": "record",
    "default": {}
  },
  {
    "key": "task.prewalk",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "tasks",
      "group": "Subagents",
      "label": "Generic Task Prewalk",
      "description": "Arm prewalk for the bundled generic `task` subagent: it starts on its resolved model, plans and begins the implementation, then hands off to the 'smol' role at its first edit/write. Per-agent overrides (task.agentPrewalk, configured from the /agents hub) and user agent `prewalk` frontmatter apply regardless of this toggle."
    }
  },
  {
    "key": "tasks.todoClearDelay",
    "type": "number",
    "default": 60,
    "ui": {
      "tab": "tools",
      "group": "Todos",
      "label": "Todo Auto-Clear Delay",
      "description": "Delay before completed or abandoned todos are removed from the todo widget",
      "options": [
        {
          "value": "0",
          "label": "Instant"
        },
        {
          "value": "60",
          "label": "1 minute",
          "description": "Default"
        },
        {
          "value": "300",
          "label": "5 minutes"
        },
        {
          "value": "900",
          "label": "15 minutes"
        },
        {
          "value": "1800",
          "label": "30 minutes"
        },
        {
          "value": "3600",
          "label": "1 hour"
        },
        {
          "value": "-1",
          "label": "Never"
        }
      ]
    }
  },
  {
    "key": "task.showResolvedModelBadge",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "appearance",
      "group": "Display",
      "label": "Show Resolved Model Badge",
      "description": "Display the actual model ID used by each subagent in the task widget status line"
    }
  },
  {
    "key": "skills.enableSkillCommands",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Commands & Skills",
      "label": "Skill Commands",
      "description": "Register skills as /skill:name commands"
    }
  },
  {
    "key": "commands.enableClaudeUser",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Commands & Skills",
      "label": "Claude User Commands",
      "description": "Load commands from ~/.claude/commands/"
    }
  },
  {
    "key": "commands.enableClaudeProject",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Commands & Skills",
      "label": "Claude Project Commands",
      "description": "Load commands from .claude/commands/"
    }
  },
  {
    "key": "commands.enableOpencodeUser",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Commands & Skills",
      "label": "OpenCode User Commands",
      "description": "Load commands from ~/.config/opencode/commands/"
    }
  },
  {
    "key": "commands.enableOpencodeProject",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tasks",
      "group": "Commands & Skills",
      "label": "OpenCode Project Commands",
      "description": "Load commands from .opencode/commands/"
    }
  },
  {
    "key": "secrets.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "providers",
      "group": "Privacy",
      "label": "Hide Secrets",
      "description": "Obfuscate configured secrets and redact credential-shaped tokens before sending to AI providers"
    }
  },
  {
    "key": "providers.ollama-cloud.maxConcurrency",
    "type": "number",
    "default": 3,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Ollama Cloud Max Concurrency",
      "description": "Maximum concurrent Ollama Cloud subagent runs per process; 0 disables the provider-specific limit"
    }
  },
  {
    "key": "providers.webSearchOrder",
    "type": "array",
    "default": [
      "searxng",
      "exa"
    ],
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Web Search Provider Order",
      "description": "Prioritized providers for the web_search tool; unlisted providers retain their default order afterward"
    }
  },
  {
    "key": "providers.webSearchExclude",
    "type": "array",
    "default": [],
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Excluded Web Search Providers",
      "description": "Providers that web_search should never use, even as fallbacks"
    }
  },
  {
    "key": "providers.webSearchTimeoutSeconds",
    "type": "number",
    "default": 60,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Web Search Timeout"
    }
  },
  {
    "key": "providers.webSearchGeminiModel",
    "type": "string",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Gemini web_search model",
      "description": "Model ID for Gemini Google Search grounding. Defaults to gemini-2.5-flash."
    }
  },
  {
    "key": "providers.antigravityEndpoint",
    "type": "enum",
    "values": [
      "auto",
      "production",
      "sandbox"
    ],
    "default": "auto",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Antigravity Endpoint Mode",
      "description": "Endpoint routing strategy for google-antigravity providers (chat, search, image, discovery)",
      "options": [
        {
          "value": "auto",
          "label": "Auto",
          "description": "Try production endpoint, fail over to sandbox on 5xx/429"
        },
        {
          "value": "production",
          "label": "Production Only",
          "description": "Force production endpoint only"
        },
        {
          "value": "sandbox",
          "label": "Sandbox Only",
          "description": "Force sandbox endpoint only"
        }
      ]
    }
  },
  {
    "key": "providers.imageOrder",
    "type": "array",
    "default": null,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Image Provider Order",
      "description": "Prioritized providers for image generation; unlisted providers follow the active session provider and the built-in order"
    }
  },
  {
    "key": "providers.fireworksTier",
    "type": "enum",
    "values": [
      "standard",
      "priority"
    ],
    "default": "standard",
    "ui": {
      "tab": "providers",
      "group": "Fireworks",
      "label": "Fireworks Tier",
      "description": "Serving path for Fireworks requests. Priority sends `service_tier: \"priority\"` for higher reliability during peak traffic at a higher price; Standard omits it. Fast (`-fast`) models ignore this — Fast is its own serving path.",
      "options": [
        {
          "value": "standard",
          "label": "Standard",
          "description": "Default serving path (no service_tier)"
        },
        {
          "value": "priority",
          "label": "Priority",
          "description": "Priority serving path: higher reliability, premium per-token pricing"
        }
      ]
    }
  },
  {
    "key": "live.voice",
    "type": "enum",
    "default": "sol",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Live Voice",
      "description": "Voice used by Codex-backed realtime voice sessions"
    }
  },
  {
    "key": "providers.tts",
    "type": "enum",
    "values": [
      "auto",
      "local",
      "xai"
    ],
    "default": "auto",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Text-to-Speech Provider",
      "description": "Backend for the tts tool: local on-device neural TTS (Kokoro-82M) or xAI Grok Voice",
      "options": [
        {
          "value": "auto",
          "label": "Auto",
          "description": "Prefer local on-device TTS; route .mp3 output to xAI when credentials exist"
        },
        {
          "value": "local",
          "label": "Local",
          "description": "On-device neural TTS (Kokoro-82M); output is WAV/PCM16"
        },
        {
          "value": "xai",
          "label": "xAI Grok Voice",
          "description": "Requires xAI Grok OAuth or XAI_API_KEY; MP3 or WAV"
        }
      ]
    }
  },
  {
    "key": "tts.localModel",
    "type": "enum",
    "default": "kokoro",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Local TTS Model",
      "description": "On-device neural TTS model (Kokoro-82M) used by the local TTS backend"
    }
  },
  {
    "key": "tts.localVoice",
    "type": "enum",
    "default": "af_heart",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Local TTS Voice",
      "description": "Kokoro voice used by the local TTS backend (American/British, female/male)"
    }
  },
  {
    "key": "speech.enabled",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Speech Vocalization",
      "description": "Speak the assistant's output aloud through the speakers as it streams"
    }
  },
  {
    "key": "speech.mode",
    "type": "enum",
    "values": [
      "all",
      "assistant",
      "yield"
    ],
    "default": "assistant",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Speech Vocalization Mode",
      "description": "What to speak: all = assistant messages + thinking; assistant = messages only; yield = only the final message at turn end",
      "options": [
        {
          "value": "all",
          "label": "All (messages + thinking)"
        },
        {
          "value": "assistant",
          "label": "Assistant messages"
        },
        {
          "value": "yield",
          "label": "Final message only"
        }
      ]
    }
  },
  {
    "key": "speech.enhanced",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Enhanced Speech Rewriting",
      "description": "Rewrite assistant output into natural spoken prose with the tiny/smol model before synthesis (describes code, drops links and markdown). Falls back to mechanical cleanup on failure"
    }
  },
  {
    "key": "speech.voice",
    "type": "enum",
    "default": "af_heart",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Speech Vocalization Voice",
      "description": "Kokoro voice used when speaking the assistant's output aloud"
    }
  },
  {
    "key": "providers.tinyModel",
    "type": "enum",
    "default": "online",
    "ui": {
      "tab": "providers",
      "group": "Tiny Model",
      "label": "Tiny Model",
      "description": "Session-title model: online (the TINY role from /models, else @smol) by default, or a local on-device model"
    }
  },
  {
    "key": "providers.tinyModelDevice",
    "type": "enum",
    "default": "default",
    "ui": {
      "tab": "providers",
      "group": "Tiny Model",
      "label": "Tiny Model Device",
      "description": "ONNX execution provider for local tiny models (titles + memory). Default uses CPU-only inference. The PI_TINY_DEVICE env var overrides this."
    }
  },
  {
    "key": "providers.tinyModelDtype",
    "type": "enum",
    "default": "default",
    "ui": {
      "tab": "providers",
      "group": "Tiny Model",
      "label": "Tiny Model Precision",
      "description": "ONNX quantization/precision for local tiny models. Default uses each model's shipped dtype (q4); lower precision is faster, higher is more faithful. The PI_TINY_DTYPE env var overrides this."
    }
  },
  {
    "key": "providers.memoryModel",
    "type": "enum",
    "default": "online",
    "ui": {
      "tab": "memory",
      "group": "General",
      "label": "Memory Model",
      "description": "Mnemopi LLM for fact extraction + consolidation: online (the TINY role from /models, else smol/remote) by default, or a local on-device model"
    }
  },
  {
    "key": "providers.autoThinkingModel",
    "type": "enum",
    "default": "online",
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Auto Thinking Model",
      "description": "Difficulty classifier for the `auto` thinking level: online (the TINY role from /models, else smol) by default, or a local on-device model"
    }
  },
  {
    "key": "providers.autoThinkingMaxEffort",
    "type": "enum",
    "values": [
      "xhigh",
      "max"
    ],
    "default": "xhigh",
    "ui": {
      "tab": "model",
      "group": "Thinking",
      "label": "Auto Thinking Ceiling",
      "description": "Highest effort the `auto` classifier may resolve. `xhigh` keeps the classifier one tier below the top, so only an explicit `ultrathink` reaches `max`; `max` lets a turn the classifier judges exceptional bill the top tier on models that expose it.",
      "condition": "autoThinkingActive",
      "options": [
        {
          "value": "xhigh",
          "label": "xhigh",
          "description": "Classifier stops at xhigh (default)"
        },
        {
          "value": "max",
          "label": "max",
          "description": "Classifier may resolve max where the model supports it"
        }
      ]
    }
  },
  {
    "key": "features.unexpectedStopDetection",
    "type": "boolean",
    "default": false,
    "ui": {
      "tab": "interaction",
      "group": "Agent",
      "label": "Detect unexpected stops",
      "description": "Use a small model to detect when the assistant says it will continue but stops without tool calls; automatically prompt it to continue."
    }
  },
  {
    "key": "providers.unexpectedStopModel",
    "type": "enum",
    "default": "online",
    "ui": {
      "tab": "providers",
      "group": "Tiny Model",
      "label": "Unexpected Stop Model",
      "description": "Classifier for unexpected-stop detection: online (the TINY role from /models, else smol) by default, or a local on-device model."
    }
  },
  {
    "key": "providers.kimiApiFormat",
    "type": "enum",
    "values": [
      "auto",
      "openai",
      "anthropic"
    ],
    "default": "auto",
    "ui": {
      "tab": "providers",
      "group": "Protocol",
      "label": "Kimi API Format",
      "description": "API format for Kimi Code provider (auto follows live model metadata)",
      "options": [
        {
          "value": "auto",
          "label": "Auto",
          "description": "Use the model's server-declared protocol"
        },
        {
          "value": "openai",
          "label": "OpenAI",
          "description": "api.kimi.com"
        },
        {
          "value": "anthropic",
          "label": "Anthropic",
          "description": "api.moonshot.ai"
        }
      ]
    }
  },
  {
    "key": "providers.openaiWebsockets",
    "type": "enum",
    "values": [
      "auto",
      "off",
      "on"
    ],
    "default": "auto",
    "ui": {
      "tab": "providers",
      "group": "Protocol",
      "label": "OpenAI WebSockets",
      "description": "Websocket policy for OpenAI Codex models (auto uses model defaults, on forces, off disables)",
      "options": [
        {
          "value": "auto",
          "label": "Auto",
          "description": "Use model/provider default websocket behavior"
        },
        {
          "value": "off",
          "label": "Off",
          "description": "Disable websockets for OpenAI Codex models"
        },
        {
          "value": "on",
          "label": "On",
          "description": "Force websockets for OpenAI Codex models"
        }
      ]
    }
  },
  {
    "key": "providers.streamFirstEventTimeoutSeconds",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "providers",
      "group": "Timeouts",
      "label": "Stream First Event Timeout",
      "description": "Seconds to wait for the first model stream event; -1 uses provider/env defaults, 0 disables the watchdog",
      "options": [
        {
          "value": "-1",
          "label": "Auto",
          "description": "Use provider defaults and PI_* timeout env vars"
        },
        {
          "value": "0",
          "label": "Off",
          "description": "Disable first-event timeout"
        },
        {
          "value": "300",
          "label": "5 minutes"
        },
        {
          "value": "600",
          "label": "10 minutes"
        },
        {
          "value": "1800",
          "label": "30 minutes"
        }
      ]
    }
  },
  {
    "key": "providers.streamIdleTimeoutSeconds",
    "type": "number",
    "default": -1,
    "ui": {
      "tab": "providers",
      "group": "Timeouts",
      "label": "Stream Idle Timeout",
      "description": "Seconds a model stream may stay silent between events; -1 uses provider/env defaults, 0 disables the watchdog",
      "options": [
        {
          "value": "-1",
          "label": "Auto",
          "description": "Use provider defaults and PI_* timeout env vars"
        },
        {
          "value": "0",
          "label": "Off",
          "description": "Disable idle timeout"
        },
        {
          "value": "300",
          "label": "5 minutes"
        },
        {
          "value": "600",
          "label": "10 minutes"
        },
        {
          "value": "1800",
          "label": "30 minutes"
        }
      ]
    }
  },
  {
    "key": "providers.openrouterVariant",
    "type": "enum",
    "values": [
      "default",
      "nitro",
      "floor",
      "online",
      "exacto"
    ],
    "default": "default",
    "ui": {
      "tab": "providers",
      "group": "Protocol",
      "label": "OpenRouter Routing",
      "description": "Default routing-variant suffix appended to OpenRouter model IDs (overridden when the selector already names a variant)",
      "options": [
        {
          "value": "default",
          "label": "Default",
          "description": "No suffix; use OpenRouter's default routing"
        },
        {
          "value": "nitro",
          "label": ":nitro",
          "description": "Prioritize throughput / lowest latency"
        },
        {
          "value": "floor",
          "label": ":floor",
          "description": "Prioritize cheapest available provider"
        },
        {
          "value": "online",
          "label": ":online",
          "description": "Enable OpenRouter's web-search plugin"
        },
        {
          "value": "exacto",
          "label": ":exacto",
          "description": "Cherry-picked high-quality providers (only defined for select models)"
        }
      ]
    }
  },
  {
    "key": "providers.fetch",
    "type": "enum",
    "values": [
      "auto",
      "native",
      "trafilatura",
      "lynx",
      "parallel",
      "jina"
    ],
    "default": "auto",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Fetch Provider",
      "description": "Reader backend priority for the fetch/read URL tool",
      "options": [
        {
          "value": "auto",
          "label": "Auto",
          "description": "Priority: native > trafilatura > lynx > parallel > jina"
        },
        {
          "value": "native",
          "label": "Native",
          "description": "In-process HTML→Markdown converter (always available)"
        },
        {
          "value": "trafilatura",
          "label": "Trafilatura",
          "description": "Auto-installs via uv/pip"
        },
        {
          "value": "lynx",
          "label": "Lynx",
          "description": "Requires lynx system package"
        },
        {
          "value": "parallel",
          "label": "Parallel",
          "description": "Requires PARALLEL_API_KEY"
        },
        {
          "value": "jina",
          "label": "Jina",
          "description": "Uses r.jina.ai reader (JINA_API_KEY optional)"
        }
      ]
    }
  },
  {
    "key": "codexResets.autoRedeem",
    "type": "enum",
    "values": [
      "unset",
      "yes",
      "no"
    ],
    "default": "unset",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Codex Auto-Redeem Saved Resets",
      "description": "Spend saved Codex rate-limit resets automatically: restore an account blocked by an exhausted 5h or weekly window when a turn is stuck and no other account can take over, and salvage credits that are about to expire. unset asks before the first spend, yes spends without prompting, and no disables both checks.",
      "options": [
        {
          "value": "unset",
          "label": "Unset",
          "description": "Check eligibility, then ask before spending the first saved reset."
        },
        {
          "value": "yes",
          "label": "Yes",
          "description": "Spend eligible saved resets without prompting."
        },
        {
          "value": "no",
          "label": "No",
          "description": "Do not run the saved-reset auto-redeem check."
        }
      ]
    }
  },
  {
    "key": "codexResets.minBlockedMinutes",
    "type": "number",
    "default": 60,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Codex Auto-Redeem Min Block",
      "description": "Only auto-redeem when the natural unblock — the latest reset among the exhausted 5h/weekly windows — is at least this many minutes away (don't spend a scarce credit to save a short wait). Raise it (e.g. 360) to ignore 5h-only blocks."
    }
  },
  {
    "key": "codexResets.keepCredits",
    "type": "number",
    "default": 0,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Codex Auto-Redeem Reserve",
      "description": "Never auto-spend below this many saved resets (0 = the last credit may be spent automatically). Credits about to expire are exempt — a reserved credit that expires preserves nothing."
    }
  },
  {
    "key": "codexResets.salvageHorizonHours",
    "type": "number",
    "default": 12,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Codex Reset Salvage Horizon",
      "description": "Spend a saved Codex reset automatically when it would otherwise expire within this many hours and either chat window (5h or weekly) has meaningful usage to restore (0 disables expiry salvage)."
    }
  },
  {
    "key": "provider.appendOnlyContext",
    "type": "enum",
    "values": [
      "auto",
      "on",
      "off"
    ],
    "default": "auto",
    "ui": {
      "tab": "providers",
      "group": "Protocol",
      "label": "Append-Only Context",
      "description": "Cache system prompt + tool specs and keep an append-only message log so provider prefix caches (DeepSeek, Xiaomi/SGLang, Anthropic) hit at maximum rate. Auto enables for known prefix-cache providers.",
      "options": [
        {
          "value": "auto",
          "label": "Auto",
          "description": "Enable for known prefix-cache providers (recommended)"
        },
        {
          "value": "on",
          "label": "On",
          "description": "Always enable append-only context"
        },
        {
          "value": "off",
          "label": "Off",
          "description": "Disable append-only context"
        }
      ]
    }
  },
  {
    "key": "exa.enabled",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Exa",
      "description": "Enable the Exa web search provider"
    }
  },
  {
    "key": "exa.searchDelayMs",
    "type": "number",
    "default": 1000,
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "Exa Search Delay",
      "description": "Minimum delay between Exa web search requests in milliseconds; set 0 to disable pacing"
    }
  },
  {
    "key": "searxng.endpoint",
    "type": "string",
    "ui": {
      "tab": "providers",
      "group": "Services",
      "label": "SearXNG Endpoint",
      "description": "Base URL of a self-hosted SearXNG instance used for web search"
    }
  },
  {
    "key": "searxng.token",
    "type": "string",
    "credential": true
  },
  {
    "key": "searxng.basicUsername",
    "type": "string"
  },
  {
    "key": "searxng.basicPassword",
    "type": "string",
    "credential": true
  },
  {
    "key": "searxng.categories",
    "type": "string"
  },
  {
    "key": "searxng.engines",
    "type": "string"
  },
  {
    "key": "searxng.language",
    "type": "string"
  },
  {
    "key": "searxng.safesearch",
    "type": "number"
  },
  {
    "key": "extensionHandlers.toolCallTimeoutMs",
    "type": "number",
    "default": 30000,
    "ui": {
      "tab": "tools",
      "group": "Extensions",
      "label": "Tool Call Handler Timeout (ms)",
      "description": "Positive finite active-work timeout for extension tool_call handlers; invalid values use 30000ms, and time awaiting OMP-owned dialogs does not count"
    }
  },
  {
    "key": "dev.autoqa",
    "type": "boolean",
    "default": true,
    "ui": {
      "tab": "tools",
      "group": "Developer",
      "label": "Auto QA",
      "description": "Automated tool issue reporting (xd://report_issue). On by default; the first report asks for consent, and denying it disables reporting until re-enabled explicitly"
    }
  },
  {
    "key": "dev.autoqaPush.endpoint",
    "type": "string",
    "default": "https://qa.omp.sh/v1/grievances",
    "ui": {
      "tab": "tools",
      "group": "Developer",
      "label": "Auto QA Push Endpoint",
      "description": "Full URL receiving Auto QA JSON reports (default https://qa.omp.sh/v1/grievances)"
    }
  },
  {
    "key": "dev.autoqaPush.token",
    "type": "string",
    "credential": true
  },
  {
    "key": "dev.autoqaConsent",
    "type": "enum",
    "values": [
      "unset",
      "granted",
      "denied"
    ],
    "default": "unset"
  }
];
