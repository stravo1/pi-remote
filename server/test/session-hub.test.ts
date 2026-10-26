import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeSource } from "./fake-source.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/project-store.ts";
import type { AgentSessionEvent, Snapshot } from "../src/pi-adapter.ts";
import type { RunNotice } from "../src/push-notifier.ts";
import { SessionHub, type RunMetrics } from "../src/session-hub.ts";

function setup(idleMinutes = 30) {
  const source = new FakeSource();
  source.stored.push(
    { id: "old", path: "/s/old", project: "/p/one", firstMessage: "Old task", modified: 1000 },
    { id: "newer", path: "/s/newer", project: "/p/one", firstMessage: "Newer task", modified: 2000 },
  );
  const metrics: RunMetrics[] = [];
  const removed: string[] = [];
  const store = {
    root: "/p",
    list: async () => ["/p/one", "/p/two"],
    remove: async (project: string) => {
      removed.push(project);
    },
  } as unknown as ProjectStore;
  const notices: RunNotice[] = [];
  const notifier = { notify: async (notice: RunNotice) => void notices.push(notice) };
  const hub = new SessionHub(source, { projectsRoot: "/p", idleMinutes }, (run) => metrics.push(run), store, notifier);
  const client = () => {
    const messages: any[] = [];
    return { messages, send: (message: string) => messages.push(JSON.parse(message)) };
  };
  return { source, hub, metrics, client, removed, notices };
}

test("lists sessions by project, newest first, and merges open unsaved sessions", async (context) => {
  const { hub } = setup();
  context.after(() => hub.close());
  const id = await hub.createSession("/p/two");
  const { projects } = await hub.getSessionList();
  assert.deepEqual(
    projects.map((project) => project.sessions.map((session) => session.id)),
    [["newer", "old"], [id]],
  );
  assert.equal(projects[0].sessions[0].isRunning, false);
});

test("rejects a project that is not configured", async (context) => {
  const { hub } = setup();
  context.after(() => hub.close());
  await assert.rejects(hub.createSession("/elsewhere"), /Unknown project/);
  await assert.rejects(hub.subscribe(setup().client(), "missing"), /Unknown session/);
});

test("fans events out in seq order and gives a late subscriber the run buffer", async (context) => {
  const { hub, source, client, metrics } = setup();
  context.after(() => hub.close());
  const first = client();
  const second = client();
  await hub.subscribe(first, "newer");
  const run = hub.prompt("newer", "Go");
  await hub.subscribe(second, "newer");
  assert.equal(second.messages[0].type, "snapshot");
  assert.equal(second.messages[0].isStreaming, true);
  assert.deepEqual(
    second.messages[0].runEvents.map((event: any) => event.type),
    ["agent_start"],
  );
  assert.equal(second.messages[0].seq, 1);
  source.sessions.get("newer")!.finish();
  await run;
  const seqs = (client: ReturnType<typeof setup>["client"] extends () => infer T ? T : never) =>
    client.messages.filter((message) => message.type === "event").map((message) => message.seq);
  assert.deepEqual(seqs(first), [1, 2]);
  assert.deepEqual(seqs(second), [2]);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].eventCount, 2);
});

test("leaves image data out of snapshots and events", async (context) => {
  const { hub, source, client } = setup();
  context.after(() => hub.close());
  const viewer = client();
  await hub.subscribe(viewer, "old");
  const session = source.sessions.get("old")!;
  const image = { type: "image" as const, mimeType: "image/png", data: "aGVsbG8=" };
  const message = {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "read",
    content: [image],
    isError: false,
    timestamp: 1,
  };
  session.messages = [message as Snapshot["messages"][number]];
  session.listener({ type: "message_end", message } as AgentSessionEvent);
  const second = client();
  await hub.subscribe(second, "old");
  const stripped = { type: "image", mimeType: "image/png" };
  assert.deepEqual(viewer.messages[1].event.message.content, [stripped]);
  assert.deepEqual(second.messages[0].messages[0].content, [stripped]);
});

test("keeps the run alive when every client leaves", async (context) => {
  const { hub, source, client } = setup();
  context.after(() => hub.close());
  const viewer = client();
  await hub.subscribe(viewer, "old");
  const run = hub.prompt("old", "Go");
  await new Promise((resolve) => setImmediate(resolve));
  hub.removeClient(viewer);
  assert.equal(source.sessions.get("old")!.is_running, true);
  source.sessions.get("old")!.finish();
  await run;
});

test("refuses to remove a project with a running session and closes idle ones", async (context) => {
  const { hub, source, client, removed } = setup();
  context.after(() => hub.close());
  await hub.subscribe(client(), "old");
  const run = hub.prompt("old", "Go");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(hub.removeGroup("/p/one"), /still running/);
  source.sessions.get("old")!.finish();
  await run;
  await hub.removeGroup("/p/one");
  assert.deepEqual(removed, ["/p/one"]);
  assert.equal(source.sessions.get("old")!.closed, true);
});

test("deletes sessions, closes open ones, and refuses a running one", async (context) => {
  const { hub, source, client } = setup();
  context.after(() => hub.close());
  await hub.subscribe(client(), "old");
  const run = hub.prompt("old", "Go");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(hub.deleteSessions(["old", "newer"]), /still running/);
  assert.equal(source.stored.length, 2);
  source.sessions.get("old")!.finish();
  await run;
  const unsaved = await hub.createSession("/p/two");
  await hub.deleteSessions(["old", "newer", unsaved]);
  assert.deepEqual(source.stored, []);
  assert.equal(source.sessions.get("old")!.closed, true);
  assert.deepEqual(
    (await hub.getSessionList()).projects.map((project) => project.sessions),
    [[], []],
  );
});

test("disposes an idle session after idleMinutes and keeps a running one", async (context) => {
  const { hub, source, client } = setup(0.0005);
  context.after(() => hub.close());
  const viewer = client();
  await hub.subscribe(viewer, "old");
  await hub.subscribe(viewer, "newer");
  const run = hub.prompt("newer", "Go");
  await new Promise((resolve) => setImmediate(resolve));
  hub.removeClient(viewer);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(source.sessions.get("old")!.closed, true);
  assert.equal(source.sessions.get("newer")!.closed, false);
  source.sessions.get("newer")!.finish();
  await run;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(source.sessions.get("newer")!.closed, true);
});

test("a new group becomes a project that can hold sessions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pi-remote-hub-groups-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const hub = new SessionHub(
    new FakeSource(),
    { projectsRoot: root, idleMinutes: 30 },
    () => {},
    new ProjectStore(root),
  );
  context.after(() => hub.close());
  const project = await hub.createGroup("notes");
  const list = await hub.getSessionList();
  assert.deepEqual(
    list.projects.map((item) => item.path),
    [project],
  );
  assert.equal(list.groupsRoot, root);
  assert.ok(await hub.createSession(project));
  await assert.rejects(hub.createGroup("../x"), /Use letters/);
  await assert.rejects(hub.createSession(join(root, "other")), /Unknown project/);
  await hub.removeGroup(project);
  assert.deepEqual((await hub.getSessionList()).projects, []);
  await assert.rejects(hub.createSession(project), /Unknown project/);
});

test("sends a run notice with the session name and the start of the reply", async (context) => {
  const { hub, source, notices, client } = setup();
  context.after(() => hub.close());
  await hub.subscribe(client(), "newer");
  const run = hub.prompt("newer", "Go");
  await new Promise((resolve) => setImmediate(resolve));
  const session = source.sessions.get("newer")!;
  session.name = "Fix the login";
  session.messages = [
    { role: "assistant", content: [{ type: "text", text: `Done.  ${"x".repeat(200)}` }] },
  ] as typeof session.messages;
  session.finish();
  await run;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].sessionId, "newer");
  assert.equal(notices[0].title, "Fix the login");
  assert.equal(notices[0].body.length, 160);
  assert.match(notices[0].body, /^Done\. x+…$/);
});
