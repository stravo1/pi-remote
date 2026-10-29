import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  ModelRuntime,
  type LoadedMcpConfig,
  type McpExtensionOptions,
  type McpServerConfig,
  type McpServerEntry,
} from "@earendil-works/pi-coding-agent";
import { createInMemoryTransportPair, InMemoryTransport } from "@earendil-works/pi-mcp/testing";
import {
  isJsonRpcRequest,
  LATEST_PROTOCOL_VERSION,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type McpTransport,
} from "@earendil-works/pi-mcp";
import { PiAdapter } from "../src/pi-adapter.ts";
import { SessionSummaryJob } from "../src/session-summary-job.ts";

async function setup(
  context: TestContext,
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
  summaryDelay = 60_000,
  mcpOptions?: McpExtensionOptions,
) {
  const directory = await mkdtemp(join(tmpdir(), "pi-remote-adapter-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: "first" }, { id: "second", reasoning: true }] });
  faux.setResponses(responses);
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.setRuntimeApiKey(faux.provider.id, "test");
  const adapter = new PiAdapter(
    { agentDir: directory, modelRuntime, model: faux.getModel() },
    join(directory, "sessions"),
    summaryDelay,
    undefined,
    mcpOptions,
  );
  return { directory, faux, adapter, modelRuntime };
}

function mcpEntry(name: string, source: string, config: McpServerConfig): McpServerEntry {
  return { name, config, source, scope: "global" };
}

interface FauxMcpTool {
  name: string;
  description: string;
  result: unknown;
}

/**
 * A minimal, in-memory MCP server for the extension's transport factory. It answers the
 * client's `initialize`, `ping`, `tools/list`, and `tools/call` requests and hides its own
 * closing behind `isClosed`, so tests can assert the session released the server.
 */
class FauxMcpServer {
  readonly calls: { name: string; args: unknown }[] = [];
  isClosed = false;
  private readonly client: InMemoryTransport;
  private readonly server: InMemoryTransport;
  private readonly name: string;
  private readonly tools: FauxMcpTool[];

  constructor(name: string, tools: FauxMcpTool[]) {
    this.name = name;
    this.tools = tools;
    const pair = createInMemoryTransportPair();
    void pair.client.start();
    // The client end goes to the session and sends to `server`; replies leave from `server`.
    pair.server.onMessage((message) => void this.handle(message));
    pair.server.onClose(() => {
      this.isClosed = true;
    });
    void pair.server.start();
    this.client = pair.client;
    this.server = pair.server;
  }

  connect(): McpTransport {
    return this.client;
  }

  private reply(request: JsonRpcRequest, result: unknown): void {
    void this.server.send({ jsonrpc: "2.0", id: request.id, result });
  }

  private error(request: JsonRpcRequest, message: string): void {
    void this.server.send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message } });
  }

  private async handle(message: JsonRpcMessage): Promise<void> {
    if (!isJsonRpcRequest(message)) return;
    switch (message.method) {
      case "initialize":
        this.reply(message, {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: this.name, version: "1.0.0" },
          instructions: "Faux MCP tools for tests.",
        });
        return;
      case "ping":
        this.reply(message, {});
        return;
      case "tools/list":
        this.reply(message, {
          tools: this.tools.map(({ name, description }) => ({
            name,
            description,
            inputSchema: { type: "object", properties: {} },
          })),
        });
        return;
      case "tools/call": {
        const { name, arguments: args } = (message.params ?? {}) as { name?: string; arguments?: unknown };
        this.calls.push({ name: name ?? "", args });
        const tool = this.tools.find((candidate) => candidate.name === name);
        if (tool) this.reply(message, structuredClone(tool.result));
        else this.error(message, `Unknown tool ${name}`);
        return;
      }
      default:
        this.error(message, `FauxMcpServer has no handler for ${message.method}`);
    }
  }
}

test("streams a scripted tool call through agent_settled and rejects overlapping prompts", async (context) => {
  const { directory, faux, adapter } = await setup(context, [
    fauxAssistantMessage([fauxToolCall("bash", { command: "printf faux" })], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("Finished.")),
  ]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  const events: string[] = [];
  session.subscribe((event) => events.push(event.type));
  const run = session.prompt("Run the scripted tool call.");
  assert.equal(session.is_running, true);
  assert.equal(session.snapshot.isStreaming, true);
  await assert.rejects(session.prompt("Too soon"), /already active/);
  await run;
  assert.equal(session.is_running, false);
  assert.equal(events[0], "agent_start");
  assert.equal(events.at(-1), "agent_settled");
  assert.ok(events.indexOf("tool_execution_start") < events.indexOf("tool_execution_end"));
  assert.equal(faux.state.callCount, 2);
});

test("lists a stored session and reopens it with the same messages", async (context) => {
  const { directory, adapter } = await setup(context, [fauxAssistantMessage(fauxText("Hi there."))]);
  const session = await adapter.create(directory);
  await session.prompt("Say hi.");
  const { messages } = session.snapshot;
  await session.close();
  const [summary] = await adapter.list(directory);
  assert.equal(summary.id, session.id);
  assert.equal(summary.firstMessage, "Say hi.");
  const userMessage = messages.find((message) => message.role === "user");
  assert.equal(summary.lastUserMessage, userMessage?.timestamp);
  const reopened = await adapter.open(directory, summary.path);
  context.after(() => reopened.close());
  assert.deepEqual(reopened.snapshot.messages, messages);
});

for (const mode of ["steer", "follow_up"] as const) {
  test(`delivers ${mode} through the SDK and exposes the pending queue`, async (context) => {
    const { directory, adapter } = await setup(context, [
      fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 0.05" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("First result."),
      fauxAssistantMessage("Follow-up result."),
    ]);
    const session = await adapter.create(directory);
    context.after(() => session.close());
    const queues: string[][] = [];
    let queued: Promise<void> | undefined;
    session.subscribe((event) => {
      if (event.type === "tool_execution_start") queued = session.queue("Queued instruction", mode);
      if (event.type === "queue_update") queues.push([...event.steering, ...event.followUp]);
    });
    await session.prompt("Work");
    await queued;
    assert.ok(queues.some((messages) => messages.includes("Queued instruction")));
    assert.deepEqual(session.snapshot.queue, { steering: [], followUp: [] });
    const users = session.snapshot.messages.filter((message) => message.role === "user");
    assert.equal(users.length, 2);
    assert.match(JSON.stringify(users[1]), /Queued instruction/);
  });
}

test("steers a queued follow-up once and keeps the other follow-ups", async (context) => {
  const { directory, adapter } = await setup(context, [
    fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 0.05" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Steered result."),
    fauxAssistantMessage("Follow-up result."),
  ]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  let queued: Promise<void> | undefined;
  session.subscribe((event) => {
    if (event.type !== "tool_execution_start") return;
    queued = (async () => {
      await session.queue("Steer this", "follow_up");
      await session.queue("Keep this", "follow_up");
      session.steerFollowUp("Steer this");
      assert.deepEqual(session.snapshot.queue, { steering: ["Steer this"], followUp: ["Keep this"] });
      assert.throws(() => session.steerFollowUp("Missing"), /no longer queued/);
    })();
  });
  await session.prompt("Work");
  await queued;
  const users = session.snapshot.messages
    .filter((message) => message.role === "user")
    .map((message) => JSON.stringify(message.content));
  assert.equal(users.length, 3);
  assert.match(users[1], /Steer this/);
  assert.match(users[2], /Keep this/);
});

test("deletes a saved session file", async (context) => {
  const { directory, adapter } = await setup(context, [fauxAssistantMessage("Saved.")]);
  const session = await adapter.create(directory);
  await session.prompt("Save this");
  await session.close();
  const [summary] = await adapter.list(directory);
  await adapter.delete(directory, summary.id);
  assert.deepEqual(await adapter.list(directory), []);
  await assert.rejects(adapter.delete(directory, summary.id), /Unknown session/);
});

test("offers available models and thinking levels and saves session choices", async (context) => {
  const { directory, adapter } = await setup(context, [fauxAssistantMessage("Saved.")]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  assert.equal(session.settings.models.filter((model) => model.provider === "faux").length, 2);
  await assert.rejects(session.setModel("faux", "missing"), /unavailable/);
  await session.setModel("faux", "second");
  assert.equal(session.settings.model?.id, "second");
  assert.throws(() => session.setThinkingLevel("impossible"), /Unsupported/);
  session.setThinkingLevel("high");
  assert.equal(session.settings.thinkingLevel, "high");
  const run = session.prompt("Save the choices");
  await assert.rejects(session.setModel("faux", "first"), /idle/);
  assert.throws(() => session.setThinkingLevel("off"), /idle/);
  await run;
  const [summary] = await adapter.list(directory);
  const reopened = await adapter.open(directory, summary.path);
  context.after(() => reopened.close());
  assert.equal(reopened.settings.model?.id, "second");
  assert.equal(reopened.settings.thinkingLevel, "high");
});

test("a queued message arriving after a run starts a new prompt", async (context) => {
  const { directory, adapter } = await setup(context, [fauxAssistantMessage("Done.")]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  await session.queue("A late follow-up", "follow_up");
  assert.match(JSON.stringify(session.snapshot.messages), /A late follow-up/);
});

test("summarizes after the first response without polling", async (context) => {
  const { directory, adapter, faux } = await setup(
    context,
    [fauxAssistantMessage("Done."), fauxAssistantMessage("Update session summaries")],
    10,
  );
  const session = await adapter.create(directory);
  context.after(() => session.close());
  await session.prompt("Add session summaries");
  const messages = session.snapshot.messages;
  assert.equal(faux.state.callCount, 1);
  for (let attempt = 0; attempt < 100 && faux.state.callCount < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal((await adapter.list(directory))[0].name, "Update session summaries");
  assert.deepEqual(session.snapshot.messages, messages);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(faux.state.callCount, 2);
});

test("summary uses only recent text and discards a result when the conversation changes", async (context) => {
  let release!: (value: ReturnType<typeof fauxAssistantMessage>) => void;
  let received = "";
  const { directory, adapter, faux } = await setup(context, [
    fauxAssistantMessage("Done."),
    (request) => {
      received = JSON.stringify(request.messages);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    fauxAssistantMessage("Current task summary"),
  ]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  await session.prompt("Original task");
  for (let index = 0; index < 8; index++) {
    session.session.agent.state.messages.push({ role: "user", content: `Recent ${index}`, timestamp: index });
  }
  const job = new SessionSummaryJob(session.session, () => session.is_running);
  context.after(() => job.close());
  const first = job.update();
  assert.equal(job.update(), first);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(received, /Original task|Recent 0|Recent 1/);
  assert.match(received, /Recent 7/);
  session.session.agent.state.messages.push({ role: "user", content: "Changed task", timestamp: 9 });
  release(fauxAssistantMessage("Stale summary"));
  await first;
  assert.equal(session.session.sessionName, undefined);
  await job.update();
  assert.equal(session.session.sessionName, "Current task summary");
  assert.equal(faux.state.callCount, 3);
});

test("periodic summaries keep the original title unless the task changes substantially", async (context) => {
  const { directory, adapter, faux } = await setup(context, [
    fauxAssistantMessage("Done."),
    fauxAssistantMessage("Build the mobile app"),
    fauxAssistantMessage("UNCHANGED"),
    fauxAssistantMessage("Deploy the production service"),
  ]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  await session.prompt("Build the mobile app");
  const job = new SessionSummaryJob(session.session, () => session.is_running);
  context.after(() => job.close());
  await job.update();
  assert.equal(session.session.sessionName, "Build the mobile app");

  session.session.agent.state.messages.push({ role: "user", content: "Fix a mobile app screen", timestamp: 1 });
  await job.update();
  assert.equal(session.session.sessionName, "Build the mobile app");

  session.session.agent.state.messages.push({ role: "user", content: "Deploy the production service", timestamp: 2 });
  await job.update();
  assert.equal(session.session.sessionName, "Deploy the production service");
  assert.equal(faux.state.callCount, 4);
});

test("summary requests carry the session ID and leave room for reasoning", async (context) => {
  let sessionId: string | undefined;
  let maxTokens: number | undefined;
  const { directory, adapter } = await setup(context, [
    fauxAssistantMessage("Done."),
    (_context, options) => {
      sessionId = options?.sessionId;
      maxTokens = options?.maxTokens;
      return fauxAssistantMessage("Summary");
    },
  ]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  await session.prompt("Task");
  const job = new SessionSummaryJob(session.session, () => session.is_running);
  context.after(() => job.close());
  await job.update();
  assert.equal(sessionId, session.session.sessionId);
  assert.equal((maxTokens ?? 0) > 1_000, true);
});

test("summaries keep the last line and skip reasoning text or quotes", async (context) => {
  const { directory, adapter } = await setup(context, [
    fauxAssistantMessage("Done."),
    fauxAssistantMessage([
      fauxThinking("The user is still working on the same task."),
      fauxText('Looking through the conversation, a fitting title would be:\n"Fix login form errors"'),
    ]),
    fauxAssistantMessage([fauxText("UNCHANGED.")]),
  ]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  await session.prompt("Fix the login form");
  const job = new SessionSummaryJob(session.session, () => session.is_running);
  context.after(() => job.close());
  await job.update();
  assert.equal(session.session.sessionName, "Fix login form errors");

  session.session.agent.state.messages.push({ role: "user", content: "Carry on", timestamp: 1 });
  await job.update();
  assert.equal(session.session.sessionName, "Fix login form errors");
});

test("summary skips busy sessions and retries after a failed response", async (context) => {
  const { directory, adapter, faux } = await setup(context, [
    fauxAssistantMessage("Done."),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "Unavailable" }),
    fauxAssistantMessage("New summary"),
  ]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  let busy = true;
  const job = new SessionSummaryJob(session.session, () => busy);
  context.after(() => job.close());
  await job.update();
  await session.prompt("Work");
  await job.update();
  assert.equal(faux.state.callCount, 1);
  busy = false;
  await assert.rejects(job.update(), /Unavailable/);
  assert.equal(session.session.sessionName, undefined);
  await job.update();
  assert.equal(session.session.sessionName, "New summary");
});

test("stores a default model that new sessions and restarts use", async (context) => {
  const { directory, adapter, modelRuntime } = await setup(context, []);
  assert.equal(adapter.getDefaultModel().model, undefined);
  await assert.rejects(adapter.setDefaultModel("faux", "missing"), /unavailable/);
  await adapter.setDefaultModel("faux", "second");
  assert.equal(adapter.getDefaultModel().model?.id, "second");
  const restarted = new PiAdapter({ agentDir: directory, modelRuntime }, join(directory, "sessions"));
  assert.equal(restarted.getDefaultModel().model?.id, "second");
  const session = await restarted.create(directory);
  context.after(() => session.close());
  assert.equal(session.settings.model?.id, "second");
});

test("falls back automatically when the stored default model is unavailable", async (context) => {
  const { directory, faux, modelRuntime } = await setup(context, []);
  await writeFile(
    join(directory, "settings.json"),
    JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-5" }),
  );
  const fallback = new PiAdapter(
    { agentDir: directory, modelRuntime, model: faux.getModel() },
    join(directory, "sessions"),
  );
  const session = await fallback.create(directory);
  context.after(() => session.close());
  assert.equal(session.settings.model?.provider, "faux");
});

test("signing out of the default model's provider clears the stored default", async (context) => {
  const { directory, adapter } = await setup(context, []);
  await adapter.setDefaultModel("faux", "second");
  await adapter.logoutProvider("faux");
  assert.equal(adapter.getDefaultModel().model, undefined);
});

test("provider settings mark providers that use an API key", async (context) => {
  const { adapter } = await setup(context, []);
  const faux = (await adapter.getProviderSettings()).find((provider) => provider.id === "faux");
  assert.equal(faux?.isUsingApiKey, true);
  assert.equal(faux?.hasStoredLogin, true);
});

test("saved provider keys persist and can be read back", async (context) => {
  const { directory, adapter } = await setup(context, []);
  await adapter.setProviderApiKey("openai", "saved-key");
  assert.equal(await adapter.getProviderApiKey("openai"), "saved-key");
  const restarted = await ModelRuntime.create({ authPath: join(directory, "auth.json"), refreshOnCreate: false });
  assert.equal((await restarted.getAuth("openai"))?.auth.apiKey, "saved-key");
});

test("refuses to sign out of a provider set up outside pi's login store", async () => {
  let isLoggedOut = false;
  const modelRuntime = {
    getProvider: () => ({ auth: {} }),
    getProviderAuthStatus: () => ({ configured: true, source: "models_json_key" }),
    logout: async () => {
      isLoggedOut = true;
    },
  };
  const adapter = new PiAdapter({ modelRuntime: modelRuntime as never });
  await assert.rejects(adapter.logoutProvider("ollama"), /models\.json or the environment/);
  assert.equal(isLoggedOut, false);
});

test("starting a provider login cancels the login that is still waiting", async () => {
  const started: string[] = [];
  const aborted: string[] = [];
  const modelRuntime = {
    getProvider: () => ({ auth: { oauth: {} } }),
    refresh: async () => undefined,
    login: (provider: string, _type: string, interaction: { signal: AbortSignal }) =>
      new Promise<void>((resolve, reject) => {
        const name = `${provider}-${started.length}`;
        started.push(name);
        interaction.signal.addEventListener("abort", () => {
          aborted.push(name);
          reject(new Error("Login cancelled"));
        });
      }),
  };
  const adapter = new PiAdapter({ modelRuntime: modelRuntime as never });
  const events: unknown[] = [];
  adapter.startProviderLogin("openai", "oauth", (event) => events.push(event));
  await new Promise((resolve) => setImmediate(resolve));
  adapter.startProviderLogin("openai", "oauth", (event) => events.push(event));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(aborted, ["openai-0"]);
  assert.deepEqual(started, ["openai-0", "openai-1"]);
  assert.deepEqual(events, []);
});

test("cancelling all provider logins releases every waiting login", async () => {
  let isWaiting = true;
  const modelRuntime = {
    getProvider: () => ({ auth: { oauth: {} } }),
    refresh: async () => undefined,
    login: (_provider: string, _type: string, interaction: { signal: AbortSignal }) =>
      new Promise<void>((_resolve, reject) => {
        interaction.signal.addEventListener("abort", () => {
          isWaiting = false;
          reject(new Error("Login cancelled"));
        });
      }),
  };
  const adapter = new PiAdapter({ modelRuntime: modelRuntime as never });
  adapter.startProviderLogin("openai", "oauth", () => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  await adapter.cancelProviderLogins();
  assert.equal(isWaiting, false);
});

test("a manual name survives a reopen and stops automatic summaries", async (context) => {
  const { directory, adapter, faux } = await setup(
    context,
    [fauxAssistantMessage("Done."), fauxAssistantMessage("Done again."), fauxAssistantMessage("Automatic name")],
    10,
  );
  const session = await adapter.create(directory);
  await session.prompt("Start work");
  session.rename("  My   chosen name ");
  assert.equal(session.name, "My chosen name");
  await session.close();
  const reopened = await adapter.open(directory, (await adapter.list(directory))[0].path);
  context.after(() => reopened.close());
  await reopened.prompt("More work");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(faux.state.callCount, 2);
  assert.equal((await adapter.list(directory))[0].name, "My chosen name");
  assert.throws(() => reopened.rename(" "), /nonempty/);
});

test("reports token usage and compacts the context on request", async (context) => {
  const { directory, adapter } = await setup(context, [
    fauxAssistantMessage("First answer."),
    fauxAssistantMessage("Second answer."),
    fauxAssistantMessage("Summary of the work so far."),
    fauxAssistantMessage("Summary of the turn prefix."),
  ]);
  await writeFile(join(directory, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
  const session = await adapter.create(directory);
  context.after(() => session.close());
  await session.prompt("First question");
  await session.prompt("Second question");
  assert.equal(session.info.userMessages, 2);
  assert.equal(session.info.assistantMessages, 2);
  assert.equal("sessionFile" in session.info, false);
  const events: string[] = [];
  session.subscribe((event) => events.push(event.type));
  await session.compact("Keep the decisions");
  assert.deepEqual(
    events.filter((type) => type.startsWith("compaction_")),
    ["compaction_start", "compaction_end"],
  );
  assert.equal(session.snapshot.isCompacting, false);
  assert.ok(session.snapshot.messages.some((message) => message.role === "compactionSummary"));
});

test("lists prompt templates and skills as slash commands", async (context) => {
  const { directory, adapter } = await setup(context, []);
  await mkdir(join(directory, "prompts"));
  await writeFile(
    join(directory, "prompts", "review.md"),
    "---\ndescription: Review the diff\nargument-hint: <path>\n---\nReview $1",
  );
  await mkdir(join(directory, "skills", "notes"), { recursive: true });
  await writeFile(
    join(directory, "skills", "notes", "SKILL.md"),
    "---\nname: notes\ndescription: Keep notes\n---\nWrite notes.",
  );
  const session = await adapter.create(directory);
  context.after(() => session.close());
  const commands = session.settings.commands;
  assert.deepEqual(
    commands.find((command) => command.name === "review"),
    { name: "review", description: "Review the diff", argumentHint: "<path>" },
  );
  assert.deepEqual(
    commands.find((command) => command.name === "skill:notes"),
    { name: "skill:notes", description: "Keep notes" },
  );
});

test("binds the codemode, tool_search, and MCP extensions when a session opens", async (context) => {
  const { directory, adapter } = await setup(context, [fauxAssistantMessage("Hi.")]);
  const session = await adapter.create(directory);
  context.after(() => session.close());
  const registered = session.session.extensionRunner
    .getRegisteredCommands()
    .map(({ invocationName }) => invocationName);
  assert.ok(registered.includes("mcp"));
  // /mcp opens an interactive manager pi remote cannot show yet, so the client does not offer it.
  assert.ok(!session.settings.commands.some((command) => command.name === "mcp"));
  // No servers are configured, so the discovery tools stay inactive.
  const active = session.session.getActiveToolNames();
  assert.ok(!active.includes("codemode"));
  assert.ok(!active.includes("tool_search"));
});

test("activates codemode and tool_search from the configured server exposures", async (context) => {
  const { directory, adapter } = await setup(context, [fauxAssistantMessage("Hi.")], 60_000, {
    loadConfig: (): LoadedMcpConfig => ({
      servers: [
        mcpEntry("faux-tools", join(directory, "mcp.json"), { command: "faux", exposure: "codemode" }),
        mcpEntry("deferred-tools", join(directory, "mcp.json"), { command: "faux", exposure: "deferred" }),
      ],
      errors: [],
    }),
    // The connection fails, and exposure already activated the discovery tools.
    createTransport: () => {
      throw new Error("No transport in this test.");
    },
  });
  const session = await adapter.create(directory);
  context.after(() => session.close());
  const active = session.session.getActiveToolNames();
  assert.ok(active.includes("codemode"));
  assert.ok(active.includes("tool_search"));
});

test("calls an MCP tool from a codemode script and closes the server on session close", async (context) => {
  const server = new FauxMcpServer("faux", [
    { name: "ping", description: "Return a hello", result: { content: [{ type: "text", text: "Faux tool ran" }] } },
  ]);
  const { directory, adapter } = await setup(
    context,
    [
      fauxAssistantMessage(
        [fauxToolCall("codemode", { code: "return (await tools.mcp__faux__ping({})).content[0].text" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Done."),
    ],
    60_000,
    {
      loadConfig: (): LoadedMcpConfig => ({
        servers: [mcpEntry("faux", join(directory, "mcp.json"), { command: "faux" })],
        errors: [],
      }),
      createTransport: () => server.connect(),
    },
  );
  const session = await adapter.create(directory);
  context.after(() => session.close());
  await session.prompt("Call the faux MCP server");
  const result = session.snapshot.messages.find(
    (message) => message.role === "toolResult" && (message as { toolName?: string }).toolName === "codemode",
  );
  assert.ok(result);
  assert.match(JSON.stringify(result), /Faux tool ran/);
  // Session tool results only record bounded metadata about the script's nested calls.
  const nested = (result as { nestedCalls?: { calls: { name: string; status: string }[] } }).nestedCalls;
  assert.ok(nested?.calls.some((call) => call.name === "mcp__faux__ping" && call.status === "ok"));
  assert.equal(server.isClosed, false);
  const events: string[] = [];
  const runner = session.session.extensionRunner;
  const emit = runner.emit.bind(runner);
  runner.emit = ((event: unknown) => {
    events.push(String((event as { type?: string }).type));
    return emit(event as Parameters<typeof emit>[0]);
  }) as typeof runner.emit;
  await session.close();
  assert.ok(events.includes("session_shutdown"));
  assert.equal(server.isClosed, true);
});
