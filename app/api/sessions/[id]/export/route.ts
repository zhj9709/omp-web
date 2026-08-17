import { NextResponse } from "next/server";
import { marked } from "marked";
import {
  resolveSessionPath,
  getSessionEntries,
  buildSessionContext,
  readSessionHeader,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { computeLeafId } from "@/lib/session-tree";
import type {
  AgentMessage,
  AssistantContentBlock,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from "@/lib/types";

export const dynamic = "force-dynamic";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(text: string): string {
  return marked.parse(text, { breaks: true, gfm: true }) as string;
}

function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type ?? "image/png"};base64,${img.source.data ?? ""}`
      : img.source.url ?? "";
  }
  return flat.data ? `data:${flat.mimeType ?? "image/png"};base64,${flat.data}` : "";
}

function renderImages(images: ImageContent[]): string {
  return images
    .map((img) => {
      const src = imageSource(img);
      return src ? `<img class="msg-img" src="${escapeHtml(src)}" alt="image" />` : "";
    })
    .join("");
}

function renderTextOrBlocks(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === "string") return renderMarkdown(content);
  const parts: string[] = [];
  const images: ImageContent[] = [];
  for (const block of content) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "image") images.push(block);
  }
  return renderMarkdown(parts.join("\n\n")) + renderImages(images);
}

function renderThinking(block: ThinkingContent): string {
  return `<details class="thinking"><summary>Thinking</summary><div class="thinking-body">${renderMarkdown(block.thinking)}</div></details>`;
}

function renderToolCall(block: ToolCallContent): string {
  const name = block.toolName || "tool";
  const hasInput = block.input && Object.keys(block.input).length > 0;
  const inputHtml = hasInput
    ? `<pre class="tool-input">${escapeHtml(JSON.stringify(block.input, null, 2))}</pre>`
    : "";
  return `<div class="tool-call"><span class="tool-call-name">Tool: ${escapeHtml(name)}</span>${inputHtml}</div>`;
}

function renderAssistantContent(content: AssistantContentBlock[]): string {
  return content
    .map((block) => {
      switch (block.type) {
        case "text": return renderMarkdown(block.text);
        case "thinking": return renderThinking(block);
        case "toolCall": return renderToolCall(block);
        case "image": return renderImages([block]);
        default: return "";
      }
    })
    .filter(Boolean)
    .join("");
}

function renderMessage(message: AgentMessage): string {
  switch (message.role) {
    case "user":
      return `<article class="msg msg-user"><div class="msg-role">User</div><div class="msg-body">${renderTextOrBlocks(message.content)}</div></article>`;

    case "assistant": {
      const modelLabel = message.provider
        ? `${message.provider}/${message.model}`
        : message.model;
      const modelHtml = modelLabel
        ? ` <span class="msg-model">${escapeHtml(modelLabel)}</span>`
        : "";
      return `<article class="msg msg-assistant"><div class="msg-role">Assistant${modelHtml}</div><div class="msg-body">${renderAssistantContent(message.content)}</div></article>`;
    }

    case "toolResult": {
      const label = message.toolName
        ? `Tool result: ${message.toolName}`
        : "Tool result";
      const errorClass = message.isError ? " msg-error" : "";
      return `<article class="msg msg-tool${errorClass}"><div class="msg-role">${escapeHtml(label)}</div><div class="msg-body">${renderTextOrBlocks(message.content)}</div></article>`;
    }

    case "custom": {
      if (!message.display) return "";
      return `<article class="msg msg-custom"><div class="msg-role">${escapeHtml(message.customType || "custom")}</div><div class="msg-body">${renderTextOrBlocks(message.content)}</div></article>`;
    }

    case "bashExecution": {
      const meta = message.exitCode !== undefined ? ` (exit ${message.exitCode})` : "";
      return `<article class="msg msg-bash"><div class="msg-role">Command${meta}</div><pre class="bash-cmd">${escapeHtml(message.command)}</pre><pre class="bash-out">${escapeHtml(message.output)}</pre></article>`;
    }

    default:
      return "";
  }
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return cleaned || "session";
}

function buildHtmlPage(title: string, cwd: string, messages: AgentMessage[]): string {
  const body = messages.map(renderMessage).filter(Boolean).join("\n");
  const cwdHtml = cwd ? `<div class="meta">${escapeHtml(cwd)}</div>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.55;
  background: #f6f7f9;
  color: #1c1e21;
  padding-bottom: 4rem;
}
@media (prefers-color-scheme: dark) {
  body { background: #181a1d; color: #e4e6e8; }
}
.export-header {
  position: sticky;
  top: 0;
  padding: 1rem 1.5rem;
  background: #ffffff;
  border-bottom: 1px solid #e3e5e8;
}
@media (prefers-color-scheme: dark) {
  .export-header { background: #202327; border-color: #34373b; }
}
.export-header h1 { margin: 0; font-size: 1.25rem; }
.export-header .meta { margin-top: 0.25rem; font-size: 0.8rem; color: #6b7280; word-break: break-all; }
.conversation { max-width: 900px; margin: 0 auto; padding: 1.5rem 1rem; }
.msg { margin: 0 0 1rem; padding: 0.75rem 1rem; border-radius: 10px; background: #ffffff; border: 1px solid #e3e5e8; }
@media (prefers-color-scheme: dark) {
  .msg { background: #202327; border-color: #34373b; }
}
.msg-role { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.35rem; }
.msg-user .msg-role { color: #2563eb; }
.msg-assistant .msg-role { color: #059669; }
.msg-tool .msg-role { color: #b45309; }
.msg-custom .msg-role { color: #7c3aed; }
.msg-bash .msg-role { color: #db2777; }
.msg-error .msg-role { color: #dc2626; }
.msg-model { font-weight: 400; text-transform: none; color: #6b7280; }
.msg-body > :first-child { margin-top: 0; }
.msg-body > :last-child { margin-bottom: 0; }
.msg-img { max-width: 100%; border-radius: 6px; margin: 0.5rem 0; display: block; }
pre {
  background: #0f1115;
  color: #e6e8eb;
  padding: 0.75rem;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.85rem;
  line-height: 1.45;
}
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
:not(pre) > code { background: rgba(128,128,128,0.15); padding: 0.1em 0.3em; border-radius: 4px; }
.tool-call { border: 1px dashed #cbd5e1; border-radius: 6px; padding: 0.5rem 0.75rem; margin: 0.5rem 0; }
@media (prefers-color-scheme: dark) {
  .tool-call { border-color: #475569; }
}
.tool-call-name { font-weight: 600; font-size: 0.85rem; }
.tool-input { margin: 0.5rem 0 0; }
.thinking { margin: 0.5rem 0; }
.thinking summary { cursor: pointer; font-size: 0.85rem; color: #6b7280; }
.thinking-body { border-left: 3px solid #d1d5db; padding-left: 0.75rem; margin-top: 0.5rem; color: #6b7280; }
.bash-cmd { margin: 0.25rem 0; }
.bash-out { margin: 0.25rem 0 0; white-space: pre-wrap; word-break: break-word; }
blockquote { border-left: 3px solid #d1d5db; margin: 0.5rem 0; padding-left: 0.75rem; color: #6b7280; }
a { color: #2563eb; }
@media (prefers-color-scheme: dark) {
  a { color: #60a5fa; }
}
table { border-collapse: collapse; margin: 0.5rem 0; }
th, td { border: 1px solid #d1d5db; padding: 0.3rem 0.6rem; }
</style>
</head>
<body>
<header class="export-header">
<h1>${escapeHtml(title)}</h1>
${cwdHtml}
</header>
<main class="conversation">
${body}
</main>
</body>
</html>`;
}

// GET /api/sessions/[id]/export
// Renders a self-contained HTML export of the full session transcript directly
// from the session JSONL file (no OMP process required). `?inline=1` displays
// the page in the browser; otherwise it is served as an attachment download.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const inline = url.searchParams.get("inline") === "1";

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc?.sessionFile || await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const header = readSessionHeader(filePath);
    const entries = getSessionEntries(filePath);
    const leafId = computeLeafId(entries);
    const context = buildSessionContext(entries, leafId);
    const title = header?.title || header?.id || "Session";

    const html = buildHtmlPage(title, header?.cwd ?? "", context.messages);

    const headers: Record<string, string> = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // The page embeds no scripts and disallows script execution via CSP, so
      // raw HTML in rendered markdown cannot execute in the viewing origin.
      "Content-Security-Policy":
        "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    };
    if (!inline) {
      headers["Content-Disposition"] =
        `attachment; filename="${safeFilename(title)}.html"`;
    }

    return new NextResponse(html, { headers });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
