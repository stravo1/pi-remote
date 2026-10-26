import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { WebSocket } from "ws";
import type { Configuration } from "../src/config.ts";
import { SessionHub } from "../src/session-hub.ts";
import { Transport, type ProviderManager } from "../src/transport.ts";
import { FakeSource } from "./fake-source.ts";
import { ProjectStore } from "../src/project-store.ts";

async function setup(context: TestContext, pingInterval = 10_000, providers?: ProviderManager) {
  const directory = await mkdtemp(join(tmpdir(), "pi-remote-transport-"));
  const source = new FakeSource();
  source.stored.push({ id: "stored", path: "/s/stored", project: directory, firstMessage: "Hello", modified: 1000 });
  const projects = [directory];
  const removals: boolean[] = [];
  const configuration: Configuration = {
    host: "127.0.0.1", port: 7710, origin: "https://pi.example.com",
    allowedUser: "me", projectsRoot: directory, idleMinutes: 30,
  };
  const store = {
    root: directory,
    list: async () => projects,
    create: async (name: string) => {
      const project = join(directory, name);
      projects.push(project);
      return project;
    },
    remove: async (project: string, isDeletingFolder: boolean) => {
      projects.splice(projects.indexOf(project), 1);
      removals.push(isDeletingFolder);
    },
  } as unknown as ProjectStore;
  const hub = new SessionHub(source, configuration, () => {}, store);
  const transport = new Transport(hub, configuration, directory, pingInterval, providers);
  context.after(async () => {
    await hub.close();
    await transport.close();
    await rm(directory, { recursive: true, force: true });
  });
  transport.server.listen(0, "127.0.0.1");
  await once(transport.server, "listening");
  const address = transport.server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  return { directory, source, transport, url, removals };
}

async function connect(url: string, options = {}) {
  const socket = new WebSocket(`${url}/ws`, {
    origin: "https://pi.example.com", headers: { "Remote-User": "me" }, ...options,
  });
  await once(socket, "open");
  return socket;
}

async function request(socket: WebSocket, command: object) {
  const reply = once(socket, "message");
  socket.send(JSON.stringify(command));
  return JSON.parse((await reply)[0].toString());
}

test("lists, creates, and rejects an unknown project", { timeout: 5000 }, async (context) => {
  const { url, directory } = await setup(context);
  const socket = await connect(url);
  const list = await request(socket, { type: "list_sessions" });
  assert.deepEqual(list.projects.map((project: any) => project.path), [directory]);
  assert.equal(list.projects[0].sessions[0].id, "stored");
  const created = await request(socket, { type: "new_session", project: directory });
  assert.equal(created.type, "session_created");
  const rejected = await request(socket, { type: "new_session", project: "/elsewhere" });
  assert.match(rejected.message, /Unknown project/);
});

test("two clients share one run and either can abort it", { timeout: 5000 }, async (context) => {
  const { url } = await setup(context);
  const first = await connect(url);
  const second = await connect(url);
  assert.equal((await request(first, { type: "subscribe", sessionId: "stored" })).type, "snapshot");
  assert.equal((await request(second, { type: "subscribe", sessionId: "stored" })).type, "snapshot");
  const started = Promise.all([once(first, "message"), once(second, "message")]);
  first.send(JSON.stringify({ type: "prompt", sessionId: "stored", text: "Hello" }));
  const [[one], [two]] = await started;
  assert.equal(one.toString(), two.toString());
  assert.equal(JSON.parse(one.toString()).seq, 1);
  const busy = await request(second, { type: "prompt", sessionId: "stored", text: "Too soon" });
  assert.match(busy.message, /already active/);
  const settled = Promise.all([once(first, "message"), once(second, "message")]);
  second.send(JSON.stringify({ type: "abort", sessionId: "stored" }));
  const [[end]] = await settled;
  assert.equal(JSON.parse(end.toString()).event.type, "agent_settled");
});

for (const options of [
  { origin: "https://evil.example.com" }, { origin: undefined },
  { headers: { "Remote-User": "other" } }, { headers: {} },
]) {
  test(`rejects an unauthorized upgrade: ${JSON.stringify(options)}`, { timeout: 5000 }, async (context) => {
    const { url } = await setup(context);
    await assert.rejects(connect(url, options), /403/);
  });
}

test("closes a socket that does not answer pings and keeps a responsive socket", { timeout: 5000 }, async (context) => {
  const { url } = await setup(context, 30);
  const healthy = await connect(url);
  const silent = await connect(url, { autoPong: false });
  await once(silent, "close");
  assert.equal(healthy.readyState, WebSocket.OPEN);
});

test("serves ping and static files, with 404 for unknown paths", async (context) => {
  const { url, directory } = await setup(context);
  await writeFile(join(directory, "index.html"), "<title>pi remote</title>");
  assert.equal((await fetch(`${url}/api/ping`)).status, 204);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(await page.text(), "<title>pi remote</title>");
  assert.equal((await fetch(`${url}/missing`)).status, 404);
  assert.equal((await fetch(`${url}/%2e%2e%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${url}/%zz`)).status, 400);
});

test("bad commands return errors and leave the socket usable", { timeout: 5000 }, async (context) => {
  const { url } = await setup(context);
  const socket = await connect(url);
  for (const command of ["not json", "null", '{"type":"abort"}', '{"type":"prompt","sessionId":"stored","text":" "}',
    '{"type":"prompt","sessionId":"wrong","text":"hello"}', '{"type":"other"}']) {
    const reply = once(socket, "message");
    socket.send(command);
    assert.equal(JSON.parse((await reply)[0].toString()).type, "error");
    assert.equal(socket.readyState, WebSocket.OPEN);
  }
});

test("new_group needs a name and creates a project", { timeout: 5000 }, async (context) => {
  const { url, removals } = await setup(context);
  const socket = await connect(url);
  assert.match((await request(socket, { type: "new_group" })).message, /must be a string/);
  const { project } = await request(socket, { type: "new_group", name: "notes" });
  assert.ok(project);
  const list = await request(socket, { type: "remove_group", project });
  assert.equal(list.type, "sessions");
  assert.ok(!list.projects.some((item: any) => item.path === project));
  const { project: other } = await request(socket, { type: "new_group", name: "other" });
  await request(socket, { type: "remove_group", project: other, deleteFolder: true });
  assert.deepEqual(removals, [false, true]);
});

test("shares queues and settings with two clients and a reconnect", { timeout: 5000 }, async (context) => {
  const { url } = await setup(context);
  const first = await connect(url);
  const second = await connect(url);
  await request(first, { type: "subscribe", sessionId: "stored" });
  await request(second, { type: "subscribe", sessionId: "stored" });
  for (const command of [
    { type: "set_model", provider: "faux", modelId: "second" },
    { type: "set_thinking_level", level: "high" },
  ]) {
    const other = once(second, "message");
    const reply = await request(first, { ...command, sessionId: "stored" });
    assert.deepEqual(reply, JSON.parse((await other)[0].toString()));
    assert.equal(reply.settings.model.id, "second");
  }
  const current = await request(first, { type: "subscribe", sessionId: "stored" });
  assert.equal(current.settings.thinkingLevel, "high");
  const started = once(second, "message");
  await request(first, { type: "prompt", sessionId: "stored", text: "Work" });
  await started;
  for (const type of ["steer", "follow_up"]) {
    const other = once(second, "message");
    const reply = await request(first, { type, sessionId: "stored", text: type });
    assert.equal(reply.event.type, "queue_update");
    assert.deepEqual(reply, JSON.parse((await other)[0].toString()));
  }
  const steered = await request(first, { type: "steer_follow_up", sessionId: "stored", text: "follow_up" });
  assert.deepEqual(steered.event, { type: "queue_update", steering: ["steer", "follow_up"], followUp: [] });
  const third = await connect(url);
  const restored = await request(third, { type: "subscribe", sessionId: "stored" });
  assert.deepEqual(restored.queue, { steering: ["steer", "follow_up"], followUp: [] });
  assert.match((await request(first, { type: "set_model", sessionId: "stored", provider: "faux", modelId: "first" })).message, /idle/);
  await request(first, { type: "abort", sessionId: "stored" });
});

test("rejects invalid settings and empty queued messages", { timeout: 5000 }, async (context) => {
  const { url } = await setup(context);
  const socket = await connect(url);
  for (const command of [
    { type: "set_model", provider: "faux", modelId: "missing" },
    { type: "set_model", modelId: "first" },
    { type: "set_thinking_level", level: "impossible" },
    { type: "set_thinking_level", level: 1 },
    { type: "steer", text: " " }, { type: "follow_up", text: "" },
  ]) {
    assert.equal((await request(socket, { ...command, sessionId: "stored" })).type, "error");
  }
});

test("lists provider status and keeps login prompts separate from credentials", async (context) => {
  const received: string[] = [];
  const providers = {
    getProviderSettings: async () => [{ id: "faux", name: "Faux", authTypes: ["api_key"], isConfigured: false, isUsingApiKey: false }],
    setProviderApiKey: async (provider: string, key: string) => { received.push(`${provider}:${key}`); },
    getProviderApiKey: async (provider: string) => `${provider}-key`,
    logoutProvider: async (provider: string) => { received.push(`logout:${provider}`); },
    startProviderLogin: (_provider: string, _type: string, notify: (event: any) => void) => {
      notify({ type: "prompt", prompt: { type: "secret", message: "API key" } });
      return "login-one";
    },
    submitProviderLogin: (loginId: string, value: string) => { received.push(`${loginId}:${value}`); },
    cancelProviderLogin: (loginId: string) => { received.push(`cancel:${loginId}`); },
  } as unknown as ProviderManager;
  const { url } = await setup(context, 10_000, providers);
  const socket = await connect(url);
  const list = await request(socket, { type: "list_providers" });
  assert.deepEqual(list, { type: "providers", providers: [{ id: "faux", name: "Faux", authTypes: ["api_key"], isConfigured: false, isUsingApiKey: false }] });
  await request(socket, { type: "set_provider_key", provider: "faux", apiKey: "secret" });
  assert.deepEqual(received, ["faux:secret"]);
  assert.deepEqual(await request(socket, { type: "get_provider_key", provider: "faux" }), { type: "provider_key", provider: "faux", apiKey: "faux-key" });
  const loginMessages: any[] = [];
  const recordMessage = (message: Buffer) => loginMessages.push(JSON.parse(message.toString()));
  socket.on("message", recordMessage);
  socket.send(JSON.stringify({ type: "start_provider_login", provider: "faux", authType: "api_key" }));
  for (let attempt = 0; attempt < 20 && loginMessages.length < 2; attempt++) await new Promise((resolve) => setImmediate(resolve));
  socket.off("message", recordMessage);
  assert.deepEqual(loginMessages, [
    { type: "provider_login_started", loginId: "login-one" },
    { type: "provider_login_event", loginId: "login-one", event: { type: "prompt", prompt: { type: "secret", message: "API key" } } },
  ]);
  socket.send(JSON.stringify({ type: "submit_provider_login", loginId: "login-one", value: "secret" }));
  for (let attempt = 0; attempt < 20 && received.length < 2; attempt++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, ["faux:secret", "login-one:secret"]);
});
