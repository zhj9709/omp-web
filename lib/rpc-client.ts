/**
 * OMP RPC JSONL client — spawns `omp --mode rpc`, negotiates protocol v2,
 * correlates requests/responses by id, reassembles chunked frames, and
 * forwards session/agent events to subscribers.
 *
 * Node.js (Next.js) replacement for the Bun-only pi SDK.
 * Never imports @oh-my-pi, @earendil-works, or any Bun-only runtime.
 */

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";

// ---------------------------------------------------------------------------
// Wire types (subset of OMP RPC protocol)
// ---------------------------------------------------------------------------

export interface RpcCommand {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

interface ReadyFrame {
  type: "ready";
  protocolVersion: number;
  supportedProtocolVersions: number[];
  maxFrameBytes: number;
  maxReassembledFrameBytes: number;
}

interface RpcChunk {
  type: "rpc_chunk";
  chunkId: string;
  index: number;
  count: number;
  byteLength: number;
  data: string;
}

export type OmpEvent = {
  type: string;
  [key: string]: unknown;
};

export type OmpEventListener = (event: OmpEvent) => void;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface OmpRpcClientOptions {
  /** Path to the omp binary. Default: "omp" from PATH or OMP_BINARY env. */
  ompPath?: string;
  /** Working directory for the omp process (project cwd). */
  cwd?: string;
  /** Extra environment variables. NEVER pass credentials here. */
  env?: Record<string, string>;
  /** Max time (ms) to wait for the ready frame. Default: 30_000. */
  readyTimeout?: number;
  /** Max time (ms) for a single command. 0 = no timeout. */
  commandTimeout?: number;
  /** Max stderr bytes to buffer for diagnostics. Default: 4096. */
  maxStderrBytes?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_READY_TIMEOUT = 30_000;
const DEFAULT_MAX_STDERR = 4096;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isResponseFrame(obj: unknown): obj is RpcResponse {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return o.type === "response" && typeof o.command === "string";
}

function isReadyFrame(obj: unknown): obj is ReadyFrame {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return o.type === "ready" && typeof o.protocolVersion === "number";
}

function isChunkFrame(obj: unknown): obj is RpcChunk {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    o.type === "rpc_chunk" &&
    typeof o.chunkId === "string" &&
    typeof o.index === "number" &&
    typeof o.count === "number" &&
    typeof o.byteLength === "number" &&
    typeof o.data === "string"
  );
}

function isOmpEvent(obj: unknown): obj is OmpEvent {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.type === "string" &&
    o.type !== "response" &&
    o.type !== "ready" &&
    o.type !== "rpc_chunk"
  );
}

// ---------------------------------------------------------------------------
// OmpRpcClient
// ---------------------------------------------------------------------------

export class OmpRpcClient {
  private process: ChildProcess | null = null;
  private listeners = new Set<OmpEventListener>();
  private pending = new Map<
    string,
    { resolve: (v: RpcResponse) => void; reject: (e: Error) => void }
  >();
  private requestSeq = 0;
  private _alive = false;
  private _ready = false;

  // Ready promise
  private readonly readyPromise: Promise<void>;
  private readonly resolveReady: () => void;
  private readonly rejectReady: (e: Error) => void;

  // Protocol state
  private protocolVersion = 1;
  private maxReassembledFrameBytes = 0;
  private chunkBuffers = new Map<
    string,
    { chunks: Map<number, string>; count: number; byteLength: number }
  >();

  // Stderr diagnostics
  private stderrBytes = 0;
  private stderrLines: string[] = [];

  // Exit tracking
  private readonly exitPromise: Promise<number | null>;
  private readonly exitResolve: (code: number | null) => void;

  private readonly options: Required<OmpRpcClientOptions>;

  constructor(options: OmpRpcClientOptions = {}) {
    this.options = {
      ompPath: options.ompPath ?? process.env.OMP_BINARY ?? "omp",
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? {},
      readyTimeout: options.readyTimeout ?? DEFAULT_READY_TIMEOUT,
      commandTimeout: options.commandTimeout ?? 0,
      maxStderrBytes: options.maxStderrBytes ?? DEFAULT_MAX_STDERR,
    };

    const ready = Promise.withResolvers<void>();
    this.readyPromise = ready.promise;
    this.resolveReady = ready.resolve;
    this.rejectReady = ready.reject;

    const exit = Promise.withResolvers<number | null>();
    this.exitPromise = exit.promise;
    this.exitResolve = exit.resolve;
  }

  // -- public accessors ------------------------------------------------------

  get alive(): boolean {
    return this._alive;
  }

  get ready(): boolean {
    return this._ready;
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  /** Wait for the ready frame (protocol negotiation complete). */
  waitReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Wait for process exit. */
  waitExit(): Promise<number | null> {
    return this.exitPromise;
  }

  /** Recent stderr lines (diagnostics only). */
  getStderr(): string[] {
    return [...this.stderrLines];
  }

  // -- lifecycle -------------------------------------------------------------

  /**
   * Spawn `omp --mode rpc` and perform protocol negotiation.
   * Resolves when the ready frame is received and v2 is negotiated (if available).
   */
  async start(): Promise<void> {
    if (this._alive) return;

    const env = { ...process.env };
    delete env.PI_WEB_PORT;
    delete env.PI_WEB_MODE;
    for (const [k, v] of Object.entries(this.options.env)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }

    this.process = spawn(this.options.ompPath, ["--mode", "rpc"], {
      cwd: this.options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this._alive = true;

    this.process.on("error", (err) => {
      this._alive = false;
      this.rejectReady(err);
      this.failAllPending(err);
      this.exitResolve(null);
    });

    this.process.on("exit", (code, signal) => {
      this._alive = false;
      this._ready = false;
      if (signal) {
        this.rejectReady(new Error(`omp exited with signal ${signal}`));
      }
      this.failAllPending(
        new Error(`omp process exited (code=${code}, signal=${signal})`),
      );
      this.exitResolve(code ?? null);
    });

    // Read stdout line by line
    const rl = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });
    rl.on("line", (line: string) => {
      this.handleLine(line);
    });

    // Stderr: bounded buffering for diagnostics
    if (this.process.stderr) {
      this.process.stderr.on("data", (chunk: Buffer) => {
        if (this.stderrBytes >= this.options.maxStderrBytes) return;
        const text = chunk.toString("utf-8");
        this.stderrBytes += Buffer.byteLength(text, "utf-8");
        const lines = text.split("\n");
        for (const l of lines) {
          if (this.stderrBytes > this.options.maxStderrBytes) {
            this.stderrLines.push("... (stderr truncated)");
            return;
          }
          if (l.trim()) this.stderrLines.push(l.trim());
        }
      });
    }

    // Ready timeout
    const readyTimer = setTimeout(() => {
      if (!this._ready) {
        this.rejectReady(new Error("omp ready timeout"));
      }
    }, this.options.readyTimeout);

    try {
      await this.readyPromise;
    } finally {
      clearTimeout(readyTimer);
    }
  }

  /**
   * Send a command and wait for the response.
   * Returns the RpcResponse. Throws on transport error.
   */
  async send(command: RpcCommand): Promise<RpcResponse> {
    if (!this._alive) throw new Error("omp process is not alive");
    if (!this._ready && command.type !== "negotiate_protocol") {
      await this.waitReady();
    }

    const id = command.id ?? `req_${++this.requestSeq}`;
    const cmd: RpcCommand = { ...command, id };

    const { promise, resolve, reject } = Promise.withResolvers<RpcResponse>();
    this.pending.set(id, { resolve, reject });

    if (this.options.commandTimeout > 0) {
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Command timeout: ${cmd.type}`));
        }
      }, this.options.commandTimeout);
    }

    this.writeLine(JSON.stringify(cmd));
    return promise;
  }

  /**
   * Send a command and unwrap: throws on failure, returns data on success.
   */
  async sendCommand<T = unknown>(command: RpcCommand): Promise<T> {
    const response = await this.send(command);
    if (!response.success) {
      throw new Error(
        response.error ?? `Command failed: ${response.command}`,
      );
    }
    return response.data as T;
  }

  // -- events ----------------------------------------------------------------

  onEvent(listener: OmpEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -- cleanup ---------------------------------------------------------------

  /** Graceful shutdown: close stdin, then SIGTERM after 1s. */
  dispose(): void {
    if (!this._alive) return;
    this._alive = false;
    this._ready = false;
    this.failAllPending(new Error("omp client disposed"));
    if (this.process) {
      try {
        this.process.stdin?.end();
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          this.process?.kill("SIGTERM");
        } catch {
          // ignore
        }
      }, 1000).unref();
    }
  }

  /** Force kill the process immediately. */
  kill(): void {
    if (!this._alive) return;
    this._alive = false;
    this._ready = false;
    this.failAllPending(new Error("omp client killed"));
    try {
      this.process?.kill("SIGKILL");
    } catch {
      // ignore
    }
  }

  // -- internals -------------------------------------------------------------

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      console.error("[omp-rpc] malformed JSON line:", line.slice(0, 200));
      return;
    }

    if (isReadyFrame(obj)) {
      this.handleReady(obj);
      return;
    }
    if (isChunkFrame(obj)) {
      this.handleChunk(obj);
      return;
    }
    if (isResponseFrame(obj)) {
      this.handleResponse(obj);
      return;
    }
    if (isOmpEvent(obj)) {
      this.handleEvent(obj);
      return;
    }

    console.error(
      "[omp-rpc] unknown frame type:",
      (obj as Record<string, unknown>).type,
    );
  }

  private handleReady(frame: ReadyFrame): void {
    this.protocolVersion = frame.protocolVersion;
    this.maxReassembledFrameBytes = frame.maxReassembledFrameBytes ?? 0;

    if (
      frame.supportedProtocolVersions?.includes(2) &&
      frame.maxReassembledFrameBytes > 0
    ) {
      this.send({ type: "negotiate_protocol", protocolVersion: 2 })
        .then(() => {
          this.protocolVersion = 2;
          this._ready = true;
          this.resolveReady();
        })
        .catch((err) => {
          console.error(
            "[omp-rpc] v2 negotiation failed, staying on v1:",
            err instanceof Error ? err.message : err,
          );
          this._ready = true;
          this.resolveReady();
        });
    } else {
      this._ready = true;
      this.resolveReady();
    }
  }

  private handleChunk(chunk: RpcChunk): void {
    if (this.protocolVersion < 2) {
      console.error("[omp-rpc] unexpected chunk on protocol v1");
      return;
    }

    let buffer = this.chunkBuffers.get(chunk.chunkId);
    if (!buffer) {
      buffer = {
        chunks: new Map(),
        count: chunk.count,
        byteLength: chunk.byteLength,
      };
      this.chunkBuffers.set(chunk.chunkId, buffer);
    }

    if (buffer.count !== chunk.count || buffer.byteLength !== chunk.byteLength) {
      console.error(`[omp-rpc] chunk ${chunk.chunkId} metadata mismatch`);
      this.chunkBuffers.delete(chunk.chunkId);
      return;
    }

    if (chunk.index < 0 || chunk.index >= chunk.count) {
      console.error(
        `[omp-rpc] chunk ${chunk.chunkId} index ${chunk.index} out of range`,
      );
      this.chunkBuffers.delete(chunk.chunkId);
      return;
    }

    if (buffer.chunks.has(chunk.index)) {
      console.error(`[omp-rpc] duplicate chunk ${chunk.chunkId}:${chunk.index}`);
      this.chunkBuffers.delete(chunk.chunkId);
      return;
    }

    buffer.chunks.set(chunk.index, chunk.data);

    if (buffer.chunks.size === buffer.count) {
      this.chunkBuffers.delete(chunk.chunkId);

      let base64 = "";
      for (let i = 0; i < buffer.count; i++) {
        base64 += buffer.chunks.get(i)!;
      }

      const decoded = Buffer.from(base64, "base64");
      if (decoded.length !== buffer.byteLength) {
        console.error(
          `[omp-rpc] chunk ${chunk.chunkId} reassembled length ${decoded.length} != expected ${buffer.byteLength}`,
        );
        return;
      }

      if (decoded.length > this.maxReassembledFrameBytes) {
        console.error(
          `[omp-rpc] chunk ${chunk.chunkId} exceeds max reassembled frame size`,
        );
        return;
      }

      const text = decoded.toString("utf-8");
      let obj: unknown;
      try {
        obj = JSON.parse(text);
      } catch {
        console.error(
          `[omp-rpc] chunk ${chunk.chunkId} reassembled to invalid JSON`,
        );
        return;
      }

      if (isResponseFrame(obj)) {
        this.handleResponse(obj);
      } else if (isOmpEvent(obj)) {
        this.handleEvent(obj);
      }
    }
  }

  private handleResponse(response: RpcResponse): void {
    const id = response.id;
    if (id && this.pending.has(id)) {
      const { resolve } = this.pending.get(id)!;
      this.pending.delete(id);
      resolve(response);
    } else if (!id && !response.success) {
      console.error(
        `[omp-rpc] error response (no id): ${response.error ?? "unknown"} (command: ${response.command})`,
      );
    }
  }

  private handleEvent(event: OmpEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(
          "[omp-rpc] event listener error:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  private writeLine(line: string): void {
    if (!this.process?.stdin || this.process.stdin.destroyed) {
      throw new Error("omp stdin is not available");
    }
    this.process.stdin.write(line + "\n");
  }

  private failAllPending(error: Error): void {
    for (const [id, { reject }] of this.pending) {
      this.pending.delete(id);
      reject(error);
    }
  }
}