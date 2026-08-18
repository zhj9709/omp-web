/**
 * Session title generation for OMP Web.
 *
 * Unlike pi-web (which runs a shadow Agent through the pi SDK), OMP Web
 * generates a title by asking the OMP-configured model directly over HTTP.
 * The model's baseUrl + resolved headers come from OMP RPC `get_state`
 * (see `OmpSessionWrapper.getModelConnection()`); the key is used only
 * server-side and is never returned to the client.
 */

export interface TitleModelConnection {
  id: string;
  baseUrl?: string;
  api?: string;
  headers: Record<string, string>;
}

export interface GeneratedSessionTitle {
  title: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

const TITLE_TIMEOUT_MS = 90_000;
const MAX_TITLE_LENGTH = 80;

const TITLE_PROMPT = `Create a concise title for this session based on the conversation above.

Requirements:
- Match the primary language used by the user.
- Describe the user's concrete goal or the outcome, not the act of chatting.
- Use 4-12 words for space-separated languages, or 8-24 characters for CJK text when practical.
- Do not call any tools.
- Return only the title as plain text, with no quotes, label, markdown, or explanation.`;

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === "`" && last === "`")
    ) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function sanitizeTitle(raw: string): string {
  const title = stripWrappingQuotes(raw)
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return title.slice(0, MAX_TITLE_LENGTH);
}

/** Deterministic fallback: the first 50 characters of the user message. */
export function fallbackTitle(firstMessage: string): string {
  const text = firstMessage.replace(/\s+/g, " ").trim();
  if (!text) return "New session";
  return text.slice(0, 50);
}

function normalizeEndpoint(baseUrl: string, api: string | undefined): URL {
  const url = new URL(baseUrl.trim());
  const trimmedPath = url.pathname.replace(/\/+$/, "");

  if (api === "anthropic-messages") {
    if (!/\/messages$/i.test(trimmedPath)) {
      url.pathname = /\/v1$/i.test(trimmedPath)
        ? `${trimmedPath}/messages`
        : `${trimmedPath}/v1/messages`;
    }
    return url;
  }

  // Default: OpenAI-compatible chat completions.
  if (!/\/chat\/completions$/i.test(trimmedPath)) {
    url.pathname = `${trimmedPath}/chat/completions`;
  }
  return url;
}

interface TitleUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

function toUsage(value: unknown): TitleUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const u = value as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);

  const input = num(u.prompt_tokens) + num(u.input_tokens);
  const output = num(u.completion_tokens) + num(u.output_tokens);
  const cacheRead =
    num(u.cached_tokens) +
    num(u.cache_read_input_tokens) +
    num(u.prompt_cache_hit_tokens);
  const cacheWrite =
    num(u.cache_creation_input_tokens) +
    num(u.prompt_cache_miss_tokens);

  if (!input && !output) return undefined;
  return { input, output, cacheRead, cacheWrite, total: input + output };
}

function extractOpenAiTitle(payload: unknown): { title: string; usage?: TitleUsage } {
  const body = payload as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Title model returned no text");
  }
  return { title: sanitizeTitle(content), usage: toUsage(body.usage) };
}

function extractAnthropicTitle(payload: unknown): { title: string; usage?: TitleUsage } {
  const body = payload as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: unknown;
  };
  const block = Array.isArray(body.content)
    ? body.content.find((b) => b?.type === "text")
    : undefined;
  if (!block?.text?.trim()) {
    throw new Error("Title model returned no text");
  }
  return { title: sanitizeTitle(block.text), usage: toUsage(body.usage) };
}

/**
 * Generate a title for the given first user message using the OMP-configured
 * model. Throws on any upstream/parse failure so callers can fall back.
 */
export async function generateSessionTitle(
  connection: TitleModelConnection,
  firstMessage: string,
): Promise<GeneratedSessionTitle> {
  if (!connection.baseUrl) {
    throw new Error("No base URL configured for the active model");
  }
  const api = connection.api ?? "openai-completions";
  if (api !== "openai-completions" && api !== "anthropic-messages") {
    throw new Error(`Unsupported model API for title generation: ${api}`);
  }

  const endpoint = normalizeEndpoint(connection.baseUrl, api);
  const headers: Record<string, string> = {
    ...connection.headers,
    "Content-Type": "application/json",
  };

  const body =
    api === "anthropic-messages"
      ? {
          model: connection.id,
          system: TITLE_PROMPT,
          messages: [{ role: "user", content: firstMessage }],
          max_tokens: 50,
        }
      : {
          model: connection.id,
          messages: [
            { role: "system", content: TITLE_PROMPT },
            { role: "user", content: firstMessage },
          ],
          max_tokens: 50,
          temperature: 0.3,
        };

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Title model returned HTTP ${response.status}${
        text ? `: ${text.slice(0, 300)}` : ""
      }`,
    );
  }

  const payload: unknown = await response.json();
  const result =
    api === "anthropic-messages"
      ? extractAnthropicTitle(payload)
      : extractOpenAiTitle(payload);

  if (!result.title) {
    throw new Error("Title model returned an empty title");
  }
  return { title: result.title, usage: result.usage };
}
