import assert from "node:assert/strict";
import { test } from "node:test";
import { NOT_CONNECTED_MESSAGE } from "../src/connection.ts";
import type { EventMessage, SnapshotMessage } from "../src/protocol.ts";
import type { Snapshot } from "../../server/src/protocol.ts";

type AgentMessage = Snapshot["messages"][number];
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
import type { SessionInfo } from "../../server/src/protocol.ts";
import { Workspace } from "../src/workspace.ts";

function setup() {
  const sent: any[] = [];
  const workspace = new Workspace();
  (workspace as any).connection = {
    is_open: true,
    send(command: object) {
      if (!this.is_open) throw new Error(NOT_CONNECTED_MESSAGE);
      sent.push(command);
    },
  };
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
  workspace.handle({
    type: "sessions",
    projects: [
      {
        path: "/p",
        sessions: [{ id: "one", name: "New summary", firstMessage: "Hi", modified: 1, isRunning: false }],
      },
    ],
  });
  assert.equal(workspace.activeSession?.name, "New summary");
});

// A minimal assistant message with the fields the wire protocol always carries.
const assistant: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "faux",
  provider: "faux",
  model: "one",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 1,
};

const snapshot: SnapshotMessage = {
  type: "snapshot",
  sessionId: "one",
  seq: 4,
  isStreaming: true,
  isCompacting: false,
  queue: { steering: [], followUp: [] },
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }], timestamp: 1 }],
  runEvents: [
    { type: "message_start", message: assistant },
    {
      type: "message_update",
      message: assistant,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel", partial: assistant },
    },
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
  const delta = (seq: number, text: string): EventMessage => ({
    type: "event",
    sessionId: "one",
    seq,
    event: {
      type: "message_update",
      message: assistant,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text, partial: assistant },
    },
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
  assert.deepEqual(sent, [{ type: "new_session", project: "/home/me/notes" }]);
});

test("keeps the groups root from the session list", () => {
  const { workspace } = setup();
  workspace.handle({ type: "sessions", projects: [], groupsRoot: "/home/me" });
  assert.equal(workspace.groupsRoot, "/home/me");
});

test("a pushed session list update also refreshes the list", () => {
  const { workspace } = setup();
  workspace.handle({
    type: "sessions",
    push: true,
    projects: [{ path: "/p", sessions: [{ id: "one", firstMessage: "Hi", modified: 1, isRunning: true }] }],
  });
  assert.equal(workspace.hasSessionList, true);
  assert.equal(workspace.activeSession?.isRunning, true);
});

test("returning to the home page refreshes the session list", () => {
  const { workspace, sent } = setup();
  (globalThis as any).location = { hash: "" };
  try {
    workspace.select("");
  } finally {
    delete (globalThis as any).location;
  }
  assert.equal(workspace.sessionId, "");
  assert.deepEqual(sent, [{ type: "unsubscribe", sessionId: "one" }, { type: "list_sessions" }]);
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
    commands: [],
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

test("loads and changes the default model for new sessions", () => {
  const { workspace, sent } = setup();
  workspace.loadDefaultModel();
  workspace.handle({ type: "default_model", models: [{ provider: "openai", id: "gpt-5", name: "GPT-5" }] });
  assert.equal(workspace.defaultModel?.model, undefined);
  workspace.setDefaultModel(JSON.stringify(["openai", "gpt-5"]));
  assert.deepEqual(sent, [
    { type: "get_default_model" },
    { type: "set_default_model", provider: "openai", modelId: "gpt-5" },
  ]);
});

test("shows the stored default model and resets it to automatic", () => {
  const { workspace, sent } = setup();
  workspace.handle({
    type: "default_model",
    models: [{ provider: "openai", id: "gpt-5", name: "GPT-5" }],
    model: { provider: "openai", id: "gpt-5", name: "GPT-5" },
  });
  assert.equal(workspace.defaultModel?.model?.id, "gpt-5");
  workspace.setDefaultModel("");
  assert.deepEqual(sent, [{ type: "set_default_model", provider: "", modelId: "" }]);
});

test("manages provider credentials without storing them in client state", () => {
  const { workspace, sent } = setup();
  workspace.listProviders();
  workspace.handle({
    type: "providers",
    providers: [
      {
        id: "openrouter",
        name: "OpenRouter",
        authTypes: ["api_key"],
        isConfigured: false,
        isUsingApiKey: false,
        hasStoredLogin: false,
      },
    ],
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
    {
      id: "openrouter",
      name: "OpenRouter",
      authTypes: ["api_key"],
      isConfigured: false,
      isUsingApiKey: false,
      hasStoredLogin: false,
    },
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

const info: SessionInfo = {
  sessionId: "one",
  userMessages: 2,
  assistantMessages: 3,
  toolCalls: 4,
  toolResults: 4,
  totalMessages: 9,
  tokens: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, total: 1500 },
  cost: 0.0123,
};

test("sends rename, info, and compact commands and shows info as a note for the open session only", () => {
  const { workspace, sent } = setup();
  workspace.renameSession("Chosen");
  workspace.showSessionInfo();
  workspace.compact("Keep decisions");
  assert.deepEqual(sent, [
    { type: "rename_session", sessionId: "one", name: "Chosen" },
    { type: "get_session_info", sessionId: "one" },
    { type: "compact", sessionId: "one", instructions: "Keep decisions" },
  ]);
  workspace.handle({ type: "session_info", sessionId: "other", info });
  assert.equal(workspace.transcript.messages.length, 0);
  workspace.handle({ type: "session_info", sessionId: "one", info });
  const [note] = workspace.transcript.messages;
  assert.equal(note.role, "notice");
  assert.match(note.content[0].text, /^- Cost: \$0\.0123$/m);
  assert.match(note.content[0].text, /1,200 in, 300 out, 1,500 total/);
});

test("notes a rename once the server saves that name, and keeps notes across a snapshot", () => {
  const { workspace } = setup();
  workspace.handle(snapshot);
  workspace.renameSession("  Fix   login ");
  const named = (seq: number, name: string): EventMessage => ({
    type: "event",
    sessionId: "one",
    seq,
    event: { type: "session_info_changed", name },
  });
  workspace.handle(named(5, "Automatic"));
  assert.equal(workspace.transcript.notices.length, 0);
  workspace.handle(named(6, "Fix login"));
  assert.equal(workspace.transcript.notices[0].content[0].text, "Renamed this session to “Fix login”.");
  workspace.handle({ ...snapshot, seq: 6 });
  assert.equal(workspace.transcript.messages.filter((message) => message.role === "notice").length, 1);
});

test("disables the composer while the context compacts", () => {
  const { workspace } = setup();
  workspace.status = "connected";
  workspace.handle({ ...snapshot, isCompacting: true });
  assert.equal(workspace.is_disabled, true);
});

function setupPush(existing?: object) {
  const { workspace, sent } = setup();
  const subscription = {
    endpoint: "https://push.example.com/a",
    toJSON: () => ({ endpoint: "https://push.example.com/a" }),
  };
  workspace.devicePush = {
    is_supported: true,
    permission: "granted",
    getSubscription: async () => existing ?? null,
    subscribe: async () => subscription,
    unsubscribe: async () => subscription.endpoint,
  } as unknown as Workspace["devicePush"];
  return { workspace, sent };
}

test("turns push on and off for this device", async () => {
  const { workspace, sent } = setupPush();
  workspace.handle({ type: "push_key", publicKey: "key" });
  await workspace.enablePush();
  assert.equal(workspace.isUpdatingPush, true);
  workspace.handle({ type: "push_subscribed" });
  assert.equal(workspace.isPushOn, true);
  await workspace.disablePush();
  workspace.handle({ type: "push_unsubscribed" });
  assert.equal(workspace.isPushOn, false);
  assert.deepEqual(sent, [
    { type: "push_subscribe", subscription: { endpoint: "https://push.example.com/a" } },
    { type: "push_unsubscribe", endpoint: "https://push.example.com/a" },
  ]);
});

test("sends an existing device subscription again when the server key arrives", async () => {
  const { workspace, sent } = setupPush({ toJSON: () => ({ endpoint: "https://push.example.com/b" }) });
  workspace.handle({ type: "push_key", publicKey: "key" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workspace.isPushOn, true);
  assert.deepEqual(sent, [{ type: "push_subscribe", subscription: { endpoint: "https://push.example.com/b" } }]);
});

test("shows a blocked permission as an error and keeps push off", async () => {
  const { workspace } = setupPush();
  workspace.devicePush.subscribe = async () => {
    throw new Error("Notifications are blocked.");
  };
  workspace.handle({ type: "push_key", publicKey: "key" });
  await workspace.enablePush();
  assert.equal(workspace.error, "Notifications are blocked.");
  assert.equal(workspace.isUpdatingPush, false);
  assert.equal(workspace.isPushOn, false);
});

test("runs /name, /compact, and /session here and sends other commands to pi", () => {
  const { workspace, sent } = setup();
  workspace.sendPrompt("/name  Fix login ");
  workspace.sendPrompt("/compact");
  workspace.sendPrompt("/compact keep the plan\nand the decisions");
  workspace.sendPrompt("/session");
  workspace.sendPrompt("/review the diff");
  assert.deepEqual(sent, [
    { type: "rename_session", sessionId: "one", name: "Fix login" },
    { type: "compact", sessionId: "one", instructions: "" },
    { type: "compact", sessionId: "one", instructions: "keep the plan\nand the decisions" },
    { type: "get_session_info", sessionId: "one" },
    { type: "prompt", sessionId: "one", text: "/review the diff", images: [] },
  ]);
  workspace.sendPrompt("/name");
  assert.equal(workspace.error, "Add a name after /name.");
  assert.equal(sent.length, 5);
});

test("clears a send error from a closed socket once the socket is open again", () => {
  const { workspace } = setup();
  (workspace as any).connection = {
    is_open: false,
    send: () => {
      throw new Error(NOT_CONNECTED_MESSAGE);
    },
  };
  assert.equal(workspace.sendPrompt("Are you there?"), false);
  assert.equal(workspace.error, NOT_CONNECTED_MESSAGE);
  assert.equal(workspace.isSending, false);
  assert.equal(workspace.is_disabled, true);
  (workspace as any).handleStatus("disconnected");
  assert.equal(workspace.error, NOT_CONNECTED_MESSAGE);
  (workspace as any).handleStatus("connected");
  assert.equal(workspace.error, "");
});

test("keeps a server error after a reconnect", () => {
  const { workspace } = setup();
  workspace.handle({ type: "error", sessionId: "one", message: "The server refused the request." });
  (workspace as any).handleStatus("disconnected");
  (workspace as any).handleStatus("connected");
  assert.equal(workspace.error, "The server refused the request.");
});

test("reports whether a send reached the socket", () => {
  const { workspace, sent } = setup();
  assert.equal(workspace.sendPrompt("Next"), true);
  assert.equal(workspace.sendPrompt("/name"), false);
  assert.equal(workspace.error, "Add a name after /name.");
  (workspace as any).connection.is_open = false;
  assert.equal(workspace.sendPrompt("Again"), false);
  assert.deepEqual(sent, [{ type: "prompt", sessionId: "one", text: "Next", images: [] }]);
});
