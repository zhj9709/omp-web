import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  createProjectCommandBashExtension,
  createProjectCommandBashOperations,
  preferUserBashExtension,
  sanitizeProjectCommandEnvironment,
} = await createJiti(import.meta.url).import("./project-command-env.ts");

function getAgentDir() {
  return join(homedir(), ".omp");
}

function createLocalBashOperations(options = {}) {
  const shell = options.shellPath ?? "/bin/sh";
  return {
    exec(command, cwd, executionOptions = {}) {
      return new Promise((resolve) => {
        const child = spawn(command, {
          cwd,
          shell,
          env: executionOptions.env ?? process.env,
          signal: executionOptions.signal,
        });
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
          executionOptions.onData?.(chunk);
        });
        child.stderr.on("data", (chunk) => { output += chunk; });
        child.on("error", (error) => resolve({ output: error.message, exitCode: 1 }));
        child.on("close", (code) => resolve({ output, exitCode: code ?? 0 }));
      });
    },
  };
}

const HOST_ENVIRONMENT = {
  PORT: "30141",
  NODE_ENV: "production",
  NEXT_RUNTIME: "nodejs",
  NEXT_PRIVATE_WORKER: "1",
  PATH: "/usr/local/bin:/usr/bin",
  HOME: "/home/pi",
  HTTPS_PROXY: "http://proxy.example",
  OPENROUTER_API_KEY: "secret",
  PI_USER_SETTING: "preserved",
};

test("sanitizes host variables using platform casing rules", () => {
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(HOST_ENVIRONMENT, "linux"),
    {
      PATH: HOST_ENVIRONMENT.PATH,
      HOME: HOST_ENVIRONMENT.HOME,
      HTTPS_PROXY: HOST_ENVIRONMENT.HTTPS_PROXY,
      OPENROUTER_API_KEY: HOST_ENVIRONMENT.OPENROUTER_API_KEY,
      PI_USER_SETTING: HOST_ENVIRONMENT.PI_USER_SETTING,
    },
  );
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(
      {
        Port: "30141",
        node_env: "production",
        Next_Runtime: "nodejs",
        NEXT_PUBLIC_FLAG: "1",
        Path: "C:\\Windows",
      },
      "win32",
    ),
    { Path: "C:\\Windows" },
  );
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(
      {
        PORT: "30141",
        Port: "project-value",
        NODE_ENV: "production",
        node_env: "project-mode",
        NEXT_RUNTIME: "nodejs",
        Next_Runtime: "project-runtime",
      },
      "linux",
    ),
    {
      Port: "project-value",
      node_env: "project-mode",
      Next_Runtime: "project-runtime",
    },
  );
});

test("agent bash removes host variables while preserving user environment", async () => {
  const original = {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    NEXT_PRIVATE_WORKER: process.env.NEXT_PRIVATE_WORKER,
    PI_USER_SETTING: process.env.PI_USER_SETTING,
  };
  Object.assign(process.env, {
    PORT: "30141",
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    NEXT_PRIVATE_WORKER: "1",
    PI_USER_SETTING: "preserved",
  });

  try {
    const extension = createProjectCommandBashExtension({
      cwd: process.cwd(),
      settings: {
        getShellCommandPrefix: () => undefined,
        getShellPath: () => undefined,
      },
    });
    let registeredTool;
    await extension.factory({
      registerTool(tool) {
        registeredTool = tool;
      },
    });

    const result = await registeredTool.execute(
      "issue-484",
      {
        command: `node -e 'console.log(JSON.stringify({PORT:process.env.PORT,NODE_ENV:process.env.NODE_ENV,NEXT_RUNTIME:process.env.NEXT_RUNTIME,NEXT_PRIVATE_WORKER:process.env.NEXT_PRIVATE_WORKER,PI_USER_SETTING:process.env.PI_USER_SETTING,PATH:process.env.PATH}))'`,
      },
      undefined,
      undefined,
      { model: undefined, thinkingLevel: "off" },
    );
    const childEnvironment = JSON.parse(result.output);

    assert.equal(childEnvironment.PORT, undefined);
    assert.equal(childEnvironment.NODE_ENV, undefined);
    assert.equal(childEnvironment.NEXT_RUNTIME, undefined);
    assert.equal(childEnvironment.NEXT_PRIVATE_WORKER, undefined);
    assert.equal(childEnvironment.PI_USER_SETTING, "preserved");
    assert.ok(childEnvironment.PATH.split(delimiter).includes(join(getAgentDir(), "bin")));
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("agent bash reads current shell settings for every execution", async () => {
  let commandPrefix = "export OMP_WEB_PREFIX=first";
  const extension = createProjectCommandBashExtension({
    cwd: process.cwd(),
    settings: {
      getShellCommandPrefix: () => commandPrefix,
      getShellPath: () => undefined,
    },
  });
  let registeredTool;
  await extension.factory({
    registerTool(tool) {
      registeredTool = tool;
    },
  });
  const execute = () => registeredTool.execute(
    "settings-reload",
    { command: "printf %s \"$OMP_WEB_PREFIX\"" },
    undefined,
    undefined,
    undefined,
  );

  assert.equal((await execute()).output, "first");
  commandPrefix = "export OMP_WEB_PREFIX=second";
  assert.equal((await execute()).output, "second");
});

test("direct bash removes host variables and allows explicit project values", async () => {
  const agentBinDir = join(process.cwd(), ".test-agent", "bin");
  const operations = createProjectCommandBashOperations({
    agentBinDir,
    baseEnvironment: {
      ...HOST_ENVIRONMENT,
      PATH: process.env.PATH,
    },
    localOperations: createLocalBashOperations(),
  });
  let output = "";

  await operations.exec(
    `NODE_ENV=test PORT=3200 node -e 'console.log(JSON.stringify({PORT:process.env.PORT,NODE_ENV:process.env.NODE_ENV,NEXT_RUNTIME:process.env.NEXT_RUNTIME,PI_USER_SETTING:process.env.PI_USER_SETTING,PATH:process.env.PATH}))'`,
    process.cwd(),
    { onData: (chunk) => { output += chunk.toString(); } },
  );
  const childEnvironment = JSON.parse(output);

  assert.equal(childEnvironment.PORT, "3200");
  assert.equal(childEnvironment.NODE_ENV, "test");
  assert.equal(childEnvironment.NEXT_RUNTIME, undefined);
  assert.equal(childEnvironment.PI_USER_SETTING, "preserved");
  assert.ok(childEnvironment.PATH.split(delimiter).includes(agentBinDir));
});

test("direct bash preserves execution controls and streaming callbacks", async () => {
  const signal = new AbortController().signal;
  let received;
  let streamed = "";
  const operations = createProjectCommandBashOperations({
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      async exec(command, cwd, options) {
        received = { command, cwd, options };
        options.onData(Buffer.from("streamed"));
        return { exitCode: 0 };
      },
    },
  });

  await operations.exec("echo ready", "/project", {
    onData: (chunk) => { streamed += chunk.toString(); },
    signal,
    timeout: 12,
  });

  assert.equal(received.command, "echo ready");
  assert.equal(received.cwd, "/project");
  assert.equal(received.options.signal, signal);
  assert.equal(received.options.timeout, 12);
  assert.equal(streamed, "streamed");
});

async function captureOperationEnvironment(options) {
  let environment;
  const operations = createProjectCommandBashOperations({
    ...options,
    localOperations: {
      async exec(_command, _cwd, executionOptions) {
        environment = executionOptions.env;
        return { exitCode: 0 };
      },
    },
  });
  await operations.exec("echo ready", "/project", {
    onData() {},
  });
  return environment;
}

test("direct bash updates the platform PATH key", async () => {
  const agentBinDir = join(process.cwd(), ".test-agent", "bin");
  const cases = [
    {
      options: { agentBinDir, baseEnvironment: { Path: "project-metadata", PATH: "/usr/bin" }, platform: "linux" },
      expected: { Path: "project-metadata", PATH: `${agentBinDir}${delimiter}/usr/bin` },
    },
    {
      options: { agentBinDir: "C:\\omp-agent\\bin", baseEnvironment: { Path: "C:\\Windows" }, platform: "win32" },
      expected: { Path: "C:\\omp-agent\\bin;C:\\Windows" },
    },
  ];

  for (const { options, expected } of cases) {
    assert.deepEqual(await captureOperationEnvironment(options), expected);
  }
});

const HOST_EXTENSION_PATH = "<inline:omp-web-project-command-environment>";

test("a user extension keeps priority over the OMP fallback bash tool", () => {
  const base = {
    extensions: [
      { path: "/user/bash.js", tools: new Set(["bash"]) },
      { path: HOST_EXTENSION_PATH, tools: new Set(["bash"]) },
    ],
    errors: [
      { path: HOST_EXTENSION_PATH, error: 'Tool "bash" conflicts with /user/bash.js' },
    ],
  };

  const result = preferUserBashExtension(base);

  assert.deepEqual(result.extensions.map((extension) => extension.path), ["/user/bash.js"]);
  assert.deepEqual(result.errors, []);
});

test("keeps the fallback bash tool when no user extension owns bash", () => {
  const base = {
    extensions: [
      { path: HOST_EXTENSION_PATH, tools: new Set(["bash"]) },
    ],
    errors: [],
  };

  const result = preferUserBashExtension(base);

  assert.equal(result, base);
});
