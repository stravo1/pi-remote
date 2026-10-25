import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { PiAdapter } from "../src/pi-adapter.ts";

test("streams a scripted tool call through agent_settled and rejects overlapping prompts", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-remote-adapter-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider();
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("bash", { command: "printf faux" })], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("Finished.")),
  ]);
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const adapter = await PiAdapter.open(directory, {
    agentDir: directory, modelRuntime, model: faux.getModel(), sessionManager: SessionManager.inMemory(directory),
  });
  context.after(() => adapter.close());
  const events: string[] = [];
  const unsubscribe = adapter.subscribe((event) => events.push(event.type));
  const run = adapter.prompt("Run the scripted tool call.");
  assert.equal(adapter.is_running, true);
  await assert.rejects(adapter.prompt("Too soon"), /already active/);
  await run;
  assert.equal(adapter.is_running, false);
  assert.equal(events[0], "agent_start");
  assert.equal(events.at(-1), "agent_settled");
  assert.ok(events.indexOf("tool_execution_start") >= 0);
  assert.ok(events.indexOf("tool_execution_start") < events.indexOf("tool_execution_end"));
  assert.ok(events.indexOf("tool_execution_end") < events.lastIndexOf("message_end"));
  assert.equal(faux.state.callCount, 2);
  unsubscribe();
});
