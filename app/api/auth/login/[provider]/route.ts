import { OmpRpcClient, type OmpEvent } from "@/lib/rpc-client";
import {
  getPendingLogin,
  registerPendingLogin,
  unregisterPendingLogin,
} from "@/lib/auth-login";

export const dynamic = "force-dynamic";

type ExtensionUiRequest = OmpEvent & {
  id: string;
  method: string;
  url?: string;
  launchUrl?: string;
  instructions?: string;
  title?: string;
  message?: string;
};

// POST /api/auth/login/[provider] — manual-code / redirect-URL fallback.
// Routes the pasted value back to OMP as an `extension_ui_response` for the
// pending `input` request the login flow emitted.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  let body: { token?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { token, code } = body;
  if (!token || !code) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const pending = getPendingLogin(token);
  if (!pending) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  if (pending.provider !== provider) {
    return Response.json({ error: "Token does not match provider" }, { status: 400 });
  }
  if (!pending.inputId) {
    return Response.json({ error: "No pending input for this login" }, { status: 409 });
  }

  pending.client
    .send({ type: "extension_ui_response", id: pending.inputId, value: code })
    .catch((err) => {
      console.error(
        "[omp-web] login extension_ui_response failed:",
        err instanceof Error ? err.message : err,
      );
    });

  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for the OAuth login flow.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  const encoder = new TextEncoder();
  const send = (
    controller: ReadableStreamDefaultController,
    data: unknown,
  ) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  const client = new OmpRpcClient({});
  const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pending = { provider, client, inputId: null as string | null };
  registerPendingLogin(token, pending);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentAuth = false;
      let sentPrompt = false;

      client.onEvent((event: OmpEvent) => {
        if (event.type !== "extension_ui_request") return;
        const request = event as ExtensionUiRequest;

        switch (request.method) {
          case "open_url":
            sentAuth = true;
            send(controller, {
              type: "auth",
              url: request.url,
              instructions: request.instructions ?? null,
              token,
            });
            break;
          case "notify":
            send(controller, {
              type: "progress",
              message: request.message ?? "Waiting for authentication…",
            });
            break;
          case "input":
            // OMP re-emits this fallback prompt in a tight loop while it waits;
            // capture the id once and only surface the prompt a single time.
            pending.inputId = pending.inputId ?? request.id;
            if (!sentAuth && !sentPrompt) {
              sentPrompt = true;
              send(controller, {
                type: "prompt_request",
                message: request.title ?? "Enter value",
                placeholder: null,
                token,
              });
            }
            break;
        }
      });

      try {
        await client.start();
        const result = await client.send({ type: "login", providerId: provider });
        if (result.success) {
          send(controller, { type: "success" });
        } else {
          send(controller, {
            type: "error",
            message: result.error ?? "Login failed",
          });
        }
      } catch (error) {
        send(controller, {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        unregisterPendingLogin(token);
        client.dispose();
        controller.close();
      }
    },
    cancel() {
      unregisterPendingLogin(token);
      client.dispose();
    },
  });

  // Abort the underlying login on client disconnect.
  req.signal.addEventListener("abort", () => {
    unregisterPendingLogin(token);
    client.dispose();
  }, { once: true });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
