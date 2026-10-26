import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { AgentSessionEvent } from "../../server/src/pi-adapter.ts";
import { Transcript } from "../src/transcript.ts";

test("replays the spike tool-call log and skips system messages", async () => {
  const contents = await readFile(new URL("./fixtures/tool-call.jsonl", import.meta.url), "utf8");
  const transcript = new Transcript();
  for (const line of contents.trim().split("\n")) transcript.apply(JSON.parse(line));
  assert.equal(
    transcript.messages.some((message) => message.role === "system"),
    false,
  );
  const assistants = transcript.messages.filter((message) => message.role === "assistant");
  assert.equal(assistants.length, 2);
  assert.deepEqual(
    assistants.map((message) =>
      message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(""),
    ),
    ["", "The output of `echo hello` is: `hello`"],
  );
  assert.equal(transcript.is_running, false);
});

test("places overlapping thinking and text deltas by contentIndex before message_end", () => {
  const transcript = new Transcript();
  // The fixture retains only the fields the transcript reads.
  const events = [
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant", content: [] } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "First thought. " },
    },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Hello" } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Last thought." },
    },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: " world." } },
  ];
  for (const event of events) transcript.apply(event as AgentSessionEvent);
  assert.deepEqual(transcript.messages[0].content, [
    { type: "thinking", text: "First thought. Last thought." },
    { type: "text", text: "Hello world." },
  ]);
  assert.equal(transcript.is_running, true);
  transcript.apply({ type: "agent_settled", aborted: true });
  assert.equal(transcript.is_running, false);
});

test("groups consecutive messages from the same sender and keeps timestamps", () => {
  const transcript = new Transcript();
  transcript.load({
    messages: [
      { role: "user", content: "Hi", timestamp: 1000 },
      { role: "assistant", content: [{ type: "text", text: "Looking." }], timestamp: 2000 },
      { role: "toolResult", content: [{ type: "text", text: "ok" }], timestamp: 3000 },
      { role: "assistant", content: [{ type: "text", text: "Done." }], timestamp: 4000 },
      { role: "user", content: "Thanks", timestamp: 5000 },
    ],
    runEvents: [],
    isStreaming: false,
    queue: { steering: [], followUp: [] },
  } as unknown as Parameters<Transcript["load"]>[0]);
  assert.deepEqual(
    transcript.messages.map((_, index) => transcript.isGroupStart(index)),
    [true, true, false, false, true],
  );
  assert.equal(transcript.messages[1].timestamp, 2000);
});

test("rebuilds tool output and diffs from history plus live events", () => {
  const assistant = {
    role: "assistant",
    content: [
      { type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "a.ts", oldText: "old", newText: "new" } },
      { type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "echo ok" } },
    ],
  };
  const events = [
    { type: "tool_execution_start", toolCallId: "edit-1", toolName: "edit", args: assistant.content[0].arguments },
    { type: "tool_execution_start", toolCallId: "bash-1", toolName: "bash", args: assistant.content[1].arguments },
    { type: "tool_execution_update", toolCallId: "bash-1", partialResult: { content: [{ type: "text", text: "o" }] } },
    { type: "tool_execution_update", toolCallId: "bash-1", partialResult: { content: [{ type: "text", text: "ok" }] } },
    {
      type: "tool_execution_end",
      toolCallId: "edit-1",
      isError: false,
      result: { content: [{ type: "text", text: "edited" }], details: { diff: "-1 old\n+1 new" } },
    },
    {
      type: "tool_execution_end",
      toolCallId: "bash-1",
      isError: true,
      result: { content: [{ type: "text", text: "aborted" }] },
    },
  ];
  const live = new Transcript();
  live.start(assistant);
  live.end(assistant);
  for (const event of events) live.apply(event as AgentSessionEvent);
  const resumed = new Transcript();
  resumed.load({
    messages: [assistant],
    runEvents: events,
    isStreaming: true,
    queue: { steering: [], followUp: ["Next"] },
  } as unknown as Parameters<Transcript["load"]>[0]);
  assert.deepEqual(resumed.tools, live.tools);
  assert.equal(resumed.tools["edit-1"].diff, "-1 old\n+1 new");
  assert.equal(resumed.tools["bash-1"].status, "error");
  assert.equal(resumed.tools["bash-1"].output, "aborted");
  assert.deepEqual(resumed.queue.followUp, ["Next"]);

  const stored = new Transcript();
  stored.load({
    messages: [
      assistant,
      {
        role: "toolResult",
        toolCallId: "edit-1",
        isError: false,
        content: [{ type: "text", text: "edited" }],
        details: { diff: "-1 old\n+1 new" },
      },
    ],
    runEvents: [],
    isStreaming: false,
    queue: { steering: [], followUp: [] },
  } as unknown as Parameters<Transcript["load"]>[0]);
  assert.equal(stored.tools["edit-1"].status, "success");
  assert.equal(stored.tools["edit-1"].diff, resumed.tools["edit-1"].diff);
  assert.equal(stored.tools["bash-1"].status, "interrupted");
});

test("replaces cumulative tool output and keeps queue state from events", () => {
  const transcript = new Transcript();
  transcript.apply({
    type: "tool_execution_start",
    toolCallId: "one",
    toolName: "bash",
    args: { command: "echo" },
  } as AgentSessionEvent);
  for (const text of ["a", "ab"])
    transcript.apply({
      type: "tool_execution_update",
      toolCallId: "one",
      partialResult: { content: [{ type: "text", text }] },
    } as AgentSessionEvent);
  assert.equal(transcript.tools.one.output, "ab");
  transcript.apply({ type: "queue_update", steering: ["Change"], followUp: ["Next"] });
  assert.deepEqual(transcript.queue, { steering: ["Change"], followUp: ["Next"] });
  transcript.apply({ type: "agent_settled", aborted: true });
  assert.equal(transcript.tools.one.status, "interrupted");
  transcript.apply({ type: "queue_update", steering: [], followUp: [] });
  assert.deepEqual(transcript.queue, { steering: [], followUp: [] });
});
