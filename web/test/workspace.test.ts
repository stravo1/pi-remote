import assert from "node:assert/strict";
import { test } from "node:test";
import { Workspace } from "../src/workspace.ts";

function setup() {
  const sent: any[] = [];
  const workspace = new Workspace();
  (workspace as any).connection = { send: (command: object) => sent.push(command) };
  workspace.sessionId = "one";
  return { workspace, sent };
}

const snapshot = { type: "snapshot", sessionId: "one", seq: 4, isStreaming: true, queue: { steering: [], followUp: [] },
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  runEvents: [
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" } },
  ] };

test("a snapshot rebuilds the transcript, including the partial message of the run", () => {
  const { workspace } = setup();
  workspace.handle(snapshot);
  assert.deepEqual(workspace.transcript.messages.map((message) => [message.role, message.content[0].text]),
    [["user", "Hi"], ["assistant", "Hel"]]);
  assert.equal(workspace.transcript.is_running, true);
});

test("applies the next event in order and subscribes again on a seq gap", () => {
  const { workspace, sent } = setup();
  workspace.handle(snapshot);
  const delta = (seq: number, text: string) => ({ type: "event", sessionId: "one", seq,
    event: { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } } });
  workspace.handle(delta(5, "lo"));
  assert.equal(workspace.transcript.messages[1].content[0].text, "Hello");
  workspace.handle(delta(7, "!"));
  assert.deepEqual(sent, [{ type: "subscribe", sessionId: "one" }]);
  assert.equal(workspace.transcript.messages[1].content[0].text, "Hello");
});

test("ignores events and snapshots for another session", () => {
  const { workspace } = setup();
  workspace.handle({ ...snapshot, sessionId: "other" });
  assert.equal(workspace.transcript.messages.length, 0);
});
