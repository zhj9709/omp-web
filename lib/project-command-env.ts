import { exec as execChild } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BashOperations } from "@/lib/pi-types";

const asyncExec = promisify(execChild);

const HOST_EXTENSION_NAME = "omp-web-project-command-environment";
const HOST_EXTENSION_PATH = `<inline:${HOST_EXTENSION_NAME}>`;

/* ── Local structural types replacing pi SDK imports ── */

interface InlineExtension {
  name: string;
  hidden?: boolean;
  factory: (pi: { registerTool(tool: BashToolDef): void }) => void;
}

interface LoadExtensionsResult {
  extensions: Array<{ path: string; tools: Set<string>; [key: string]: unknown }>;
  errors: Array<{ path: string; error: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface BashToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: { type: string; content: string }) => void) | undefined,
    context: { cwd: string; [key: string]: unknown },
  ): Promise<unknown>;
}

/* ── Local replacements for pi SDK runtime functions ── */

function getAgentDir(): string {
  return join(homedir(), ".omp");
}

function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
  const shell = options?.shellPath ?? "/bin/sh";
  return {
    async exec(command, cwd, executionOptions) {
      const env = executionOptions?.env ?? process.env;
      try {
        const { stdout, stderr } = await asyncExec(command, {
          cwd,
          shell,
          env,
          timeout: executionOptions?.timeout,
          signal: executionOptions?.signal,
          maxBuffer: 10 * 1024 * 1024,
        });
        const output = stderr ? `${stdout}\n${stderr}` : stdout;
        return { output, exitCode: 0 };
      } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number; signal?: NodeJS.Signals | null };
        const output = [err.stdout ?? "", err.stderr ?? ""].filter(Boolean).join("\n");
        return { output, exitCode: err.code ?? 1, cancelled: err.signal === "SIGTERM" };
      }
    },
  };
}

function createBashToolDefinition(
  cwd: string,
  options?: {
    commandPrefix?: string;
    operations?: BashOperations;
  },
): BashToolDef {
  return {
    name: "bash",
    description: "Execute a shell command in the project directory",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        description: { type: "string", description: "What this command does" },
        timeout: { type: "number", description: "Timeout in milliseconds" },
      },
      required: ["command"],
    },
    async execute(toolCallId, params, signal, onUpdate, context) {
      const command = options?.commandPrefix
        ? `${options.commandPrefix}\n${params.command as string}`
        : (params.command as string);
      const operations = options?.operations ?? createLocalBashOperations();
      const result = await operations.exec(command, cwd, {
        env: context?.env as NodeJS.ProcessEnv | undefined,
        signal,
      });
      return { output: result.output, exitCode: result.exitCode };
    },
  };
}

type ProjectShellSettings = {
  getShellCommandPrefix(): string | undefined;
  getShellPath(): string | undefined;
};

type ProjectCommandBashOperationsOptions = {
  agentBinDir?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  localOperations?: BashOperations;
  platform?: NodeJS.Platform;
  shellPath?: string;
};

function isHostRuntimeVariable(name: string, platform: NodeJS.Platform): boolean {
  const comparableName = platform === "win32" ? name.toUpperCase() : name;
  return comparableName === "PORT"
    || comparableName === "NODE_ENV"
    || comparableName.startsWith("NEXT_");
}

export function sanitizeProjectCommandEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (isHostRuntimeVariable(name, platform)) delete environment[name];
  }
  return environment;
}

function withAgentBinDirectory(
  environment: NodeJS.ProcessEnv,
  agentBinDir: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const pathKey = platform === "win32"
    ? Object.keys(environment).find((name) => name.toUpperCase() === "PATH") ?? "PATH"
    : "PATH";
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const currentPath = environment[pathKey] ?? "";
  const pathEntries = currentPath.split(pathDelimiter).filter(Boolean);
  if (!pathEntries.includes(agentBinDir)) {
    environment[pathKey] = [agentBinDir, currentPath].filter(Boolean).join(pathDelimiter);
  }
  return environment;
}

export function createProjectCommandBashOperations(
  options: ProjectCommandBashOperationsOptions = {},
): BashOperations {
  const {
    agentBinDir = join(getAgentDir(), "bin"),
    baseEnvironment = process.env,
    localOperations = createLocalBashOperations({ shellPath: options.shellPath }),
    platform = process.platform,
  } = options;

  return {
    exec(command, cwd, executionOptions) {
      const environment = withAgentBinDirectory(
        sanitizeProjectCommandEnvironment(executionOptions?.env ?? baseEnvironment, platform),
        agentBinDir,
        platform,
      );
      return localOperations.exec(command, cwd, {
        ...executionOptions,
        env: environment,
      });
    },
  };
}

export function createProjectCommandBashExtension(options: {
  cwd: string;
  settings: ProjectShellSettings;
}): InlineExtension {
  return {
    name: HOST_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const displayDefinition = createBashToolDefinition(options.cwd);
      pi.registerTool({
        ...displayDefinition,
        execute(toolCallId, params, signal, onUpdate, context) {
          const executionDefinition = createBashToolDefinition(options.cwd, {
            commandPrefix: options.settings.getShellCommandPrefix(),
            operations: createProjectCommandBashOperations({
              shellPath: options.settings.getShellPath(),
            }),
          });
          return executionDefinition.execute(toolCallId, params, signal, onUpdate, context);
        },
      });
    },
  };
}

export function preferUserBashExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  const hostExtensionIndex = base.extensions.findIndex((extension) => extension.path === HOST_EXTENSION_PATH);
  if (hostExtensionIndex < 0) return base;

  const userBashOwner = base.extensions
    .slice(0, hostExtensionIndex)
    .find((extension) => extension.tools.has("bash"));
  if (!userBashOwner) return base;

  return {
    ...base,
    extensions: base.extensions.filter((_, index) => index !== hostExtensionIndex),
    errors: base.errors.filter((error) => !(
      error.path === HOST_EXTENSION_PATH
      && error.error === `Tool "bash" conflicts with ${userBashOwner.path}`
    )),
  };
}
