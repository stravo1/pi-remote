import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCall } from "../src/tools.ts";
import type { TranscriptMessage } from "../src/transcript.ts";
import { MINIMUM_GROUP_SIZE, getTranscriptItems } from "../src/tool-runs.ts";

function tool(id: string): ToolCall {
  return { id, name: "bash", arguments: { command: `echo ${id}` }, status: "success", output: "" };
}

function tools(...ids: string[]): Record<string, ToolCall> {
  return Object.fromEntries(ids.map((id) => [id, tool(id)]));
}

function call(...ids: string[]): TranscriptMessage {
  return {
    role: "assistant",
    content: ids.map((id) => ({
      type: "toolCall",
      text: `bash ${id}`,
      toolCall: { id, name: "bash", arguments: { command: `echo ${id}` } },
    })),
  };
}

function result(id: string): TranscriptMessage {
  return { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "ok" }] };
}

function text(value: string): TranscriptMessage {
  return { role: "assistant", content: [{ type: "text", text: value }] };
}

test("folds a run of tool calls across messages and results into one item", () => {
  const messages = [text("Checking."), call("a"), result("a"), call("b", "c"), result("b"), result("c")];
  const items = getTranscriptItems(messages, tools("a", "b", "c"));
  assert.deepEqual(items, [
    { type: "message", index: 0 },
    { type: "tools", indexes: [1, 3], toolCallIds: ["a", "b", "c"] },
  ]);
});

test("leaves a short run as separate messages", () => {
  const messages = [call("a"), result("a"), call("b"), result("b")];
  const items = getTranscriptItems(messages, tools("a", "b"));
  assert.deepEqual(items, [
    { type: "message", index: 0 },
    { type: "message", index: 2 },
  ]);
});

test("keeps a full group only when it reaches the minimum size", () => {
  assert.equal(MINIMUM_GROUP_SIZE > 1, true);
  const ids = Array.from({ length: MINIMUM_GROUP_SIZE }, (_, index) => `call-${index}`);
  const messages = ids.flatMap((id) => [call(id), result(id)]);
  const items = getTranscriptItems(messages, tools(...ids));
  assert.deepEqual(items, [
    {
      type: "tools",
      indexes: ids.map((_, index) => index * 2),
      toolCallIds: ids,
    },
  ]);
});

test("breaks a run on text, on thinking alone, and on tool output without a card", () => {
  const messages: TranscriptMessage[] = [
    call("a"),
    text("Reading the file."),
    call("b"),
    { role: "assistant", content: [{ type: "thinking", text: "Thinking." }] },
    call("c"),
    { role: "toolResult", toolCallId: "missing", content: [{ type: "text", text: "orphan" }] },
    call("d"),
  ];
  const items = getTranscriptItems(messages, tools("a", "b", "c", "d"));
  assert.deepEqual(items, [
    { type: "message", index: 0 },
    { type: "message", index: 1 },
    { type: "message", index: 2 },
    { type: "message", index: 3 },
    { type: "message", index: 4 },
    { type: "message", index: 5 },
    { type: "message", index: 6 },
  ]);
});

test("skips empty messages and holds the run through an open assistant message", () => {
  const messages = [call("a", "b"), { role: "assistant", content: [] }, call("c")];
  const items = getTranscriptItems(messages, tools("a", "b", "c"));
  assert.deepEqual(items, [{ type: "tools", indexes: [0, 2], toolCallIds: ["a", "b", "c"] }]);
});

test("keeps thinking blocks inside the tool message, not as a break", () => {
  const messages: TranscriptMessage[] = [
    { role: "assistant", content: [{ type: "thinking", text: "One." }, call("a").content[0]] },
    call("b"),
    call("c"),
  ];
  const items = getTranscriptItems(messages, tools("a", "b", "c"));
  assert.deepEqual(items, [{ type: "tools", indexes: [0, 1, 2], toolCallIds: ["a", "b", "c"] }]);
});

test("reports transcript indexes for a slice of the messages", () => {
  const messages = [call("a"), call("b"), call("c")];
  const items = getTranscriptItems(messages, tools("a", "b", "c"), 12);
  assert.deepEqual(items, [{ type: "tools", indexes: [12, 13, 14], toolCallIds: ["a", "b", "c"] }]);
});
