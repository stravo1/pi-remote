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

test("refreshes session names when the summary changes", () => {
  const { workspace, sent } = setup();
  workspace.handle({
    type: "event",
    sessionId: "one",
    seq: 1,
    event: { type: "session_info_changed", name: "New summary" },
  });
  assert.deepEqual(sent, [{ type: "list_sessions" }]);
  workspace.handle({ type: "sessions", projects: [{ path: "/p", sessions: [{ id: "one", name: "New summary" }] }] });
  assert.equal(workspace.activeSession?.name, "New summary");
});

const snapshot = {
  type: "snapshot",
  sessionId: "one",
  seq: 4,
  isStreaming: true,
  queue: { steering: [], followUp: [] },
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  runEvents: [
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" } },
  ],
};

test("a snapshot rebuilds the transcript, including the partial message of the run", () => {
  const { workspace } = setup();
  workspace.handle(snapshot);
  assert.deepEqual(
    workspace.transcript.messages.map((message) => [message.role, message.content[0].text]),
    [
      ["user", "Hi"],
      ["assistant", "Hel"],
    ],
  );
  assert.equal(workspace.transcript.is_running, true);
});

test("applies the next event in order and subscribes again on a seq gap", () => {
  const { workspace, sent } = setup();
  workspace.handle(snapshot);
  const delta = (seq: number, text: string) => ({
    type: "event",
    sessionId: "one",
    seq,
    event: { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } },
  });
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

test("picks the project of the open session for a new session", () => {
  const { workspace } = setup();
  workspace.projects = [
    { path: "/p/one", sessions: [] },
    { path: "/p/two", sessions: [{ id: "one", firstMessage: "", modified: 1, isRunning: false }] },
  ];
  assert.equal(workspace.activeProjectPath, "/p/two");
  workspace.sessionId = "missing";
  assert.equal(workspace.activeProjectPath, "/p/one");
});

test("starts a session in a new group", () => {
  const { workspace, sent } = setup();
  workspace.handle({ type: "group_created", project: "/home/me/notes" });
  assert.equal(workspace.lastGroup, "/home/me/notes");
  assert.deepEqual(sent, [{ type: "new_session", project: "/home/me/notes" }]);
});

test("keeps the groups root from the session list", () => {
  const { workspace } = setup();
  workspace.handle({ type: "sessions", projects: [], groupsRoot: "/home/me" });
  assert.equal(workspace.groupsRoot, "/home/me");
});

test("queues input during a run as a follow-up and steers a queued follow-up", () => {
  const { workspace, sent } = setup();
  workspace.status = "connected";
  workspace.transcript.is_running = true;
  assert.equal(workspace.is_disabled, false);
  workspace.sendPrompt("Next");
  workspace.handle({
    type: "event",
    sessionId: "one",
    seq: 1,
    event: { type: "queue_update", steering: [], followUp: ["Next"] },
  });
  assert.equal(workspace.isSending, false);
  workspace.steerFollowUp("Next");
  assert.deepEqual(sent, [
    { type: "follow_up", sessionId: "one", text: "Next" },
    { type: "steer_follow_up", sessionId: "one", text: "Next" },
  ]);
});

test("uses server settings and ignores errors from another session", () => {
  const { workspace, sent } = setup();
  const settings = {
    model: { provider: "faux", id: "one", name: "One" },
    models: [{ provider: "faux", id: "one", name: "One" }],
    thinkingLevel: "off",
    thinkingLevels: ["off", "high"],
  };
  workspace.handle({ ...snapshot, settings });
  workspace.setModel(JSON.stringify(["faux", "one"]));
  workspace.setThinkingLevel("high");
  assert.deepEqual(sent, [
    { type: "set_model", sessionId: "one", provider: "faux", modelId: "one" },
    { type: "set_thinking_level", sessionId: "one", level: "high" },
  ]);
  workspace.handle({ type: "error", sessionId: "other", message: "old failure" });
  assert.equal(workspace.error, "");
  workspace.handle({ ...snapshot, settings: { ...settings, thinkingLevel: "high" } });
  assert.equal(workspace.settings?.thinkingLevel, "high");
  assert.equal(workspace.isUpdatingSettings, false);
});

test("manages provider credentials without storing them in client state", () => {
  const { workspace, sent } = setup();
  workspace.listProviders();
  workspace.handle({
    type: "providers",
    providers: [{ id: "openrouter", name: "OpenRouter", authTypes: ["api_key"], isConfigured: false }],
  });
  workspace.setProviderKey("openrouter", "secret");
  workspace.startProviderLogin("openrouter", "api_key");
  workspace.handle({ type: "provider_login_started", loginId: "login-one" });
  workspace.handle({
    type: "provider_login_event",
    loginId: "login-one",
    event: { type: "prompt", prompt: { type: "secret", message: "API key" } },
  });
  workspace.submitProviderLogin("another-secret");
  assert.deepEqual(workspace.providers, [
    { id: "openrouter", name: "OpenRouter", authTypes: ["api_key"], isConfigured: false },
  ]);
  assert.equal(workspace.providerLogin?.event?.type, "prompt");
  assert.deepEqual(sent, [
    { type: "list_providers" },
    { type: "set_provider_key", provider: "openrouter", apiKey: "secret" },
    { type: "start_provider_login", provider: "openrouter", authType: "api_key" },
    { type: "submit_provider_login", loginId: "login-one", value: "another-secret" },
  ]);
});

test("keeps the sign-in link while the login waits for a pasted code", () => {
  const workspace = new Workspace();
  workspace.startProviderLogin("openai", "oauth");
  workspace.handle({ type: "provider_login_started", loginId: "login-one" });
  const link = { type: "auth_url" as const, url: "https://example.com/sign-in" };
  workspace.handle({ type: "provider_login_event", loginId: "login-one", event: link });
  workspace.handle({
    type: "provider_login_event",
    loginId: "login-one",
    event: { type: "prompt", prompt: { type: "text", message: "Paste the URL" } },
  });
  assert.equal(workspace.providerLogin?.event?.type, "prompt");
  assert.deepEqual(workspace.providerLogin?.notice, link);
});

test("knows when the first session list has arrived", () => {
  const { workspace } = setup();
  assert.equal(workspace.hasSessionList, false);
  workspace.handle({ type: "sessions", projects: [] });
  assert.equal(workspace.hasSessionList, true);
});
