import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiAdapter } from "../src/pi-adapter.ts";

async function setup(context: TestContext, responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
  const directory = await mkdtemp(join(tmpdir(), "pi-remote-adapter-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider();
  faux.setResponses(responses);
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const adapter = new PiAdapter({ agentDir: directory, modelRuntime, model: faux.getModel() }, join(directory, "sessions"));
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
