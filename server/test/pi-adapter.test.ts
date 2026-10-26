import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiAdapter } from "../src/pi-adapter.ts";
import { SessionSummaryJob } from "../src/session-summary-job.ts";

async function setup(context: TestContext, responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0], summaryDelay = 60_000) {
  const directory = await mkdtemp(join(tmpdir(), "pi-remote-adapter-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: "first" }, { id: "second", reasoning: true }] });
  faux.setResponses(responses);
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.setRuntimeApiKey(faux.provider.id, "test");
  const adapter = new PiAdapter({ agentDir: directory, modelRuntime, model: faux.getModel() }, join(directory, "sessions"), summaryDelay);
  return { directory, faux, adapter };
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

test("updates the summary after the conversation changes without polling", async (context) => {
  const { directory, adapter, faux } = await setup(context, [
    fauxAssistantMessage("Done."), fauxAssistantMessage("Update session summaries"),
  ], 10);
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
      return new Promise((resolve) => { release = resolve; });
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

test("starting a provider login cancels the login that is still waiting", async () => {
  const started: string[] = [];
  const aborted: string[] = [];
  const modelRuntime = {
    getProvider: () => ({ auth: { oauth: {} } }),
    refresh: async () => undefined,
    login: (provider: string, _type: string, interaction: { signal: AbortSignal }) => new Promise<void>((resolve, reject) => {
      const name = `${provider}-${started.length}`;
      started.push(name);
      interaction.signal.addEventListener("abort", () => { aborted.push(name); reject(new Error("Login cancelled")); });
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
