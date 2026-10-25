import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeSource } from "./fake-source.ts";
import { SessionHub, type RunMetrics } from "../src/session-hub.ts";

function setup(idleMinutes = 30) {
  const source = new FakeSource();
  source.stored.push(
    { id: "old", path: "/s/old", project: "/p/one", firstMessage: "Old task", modified: 1000 },
    { id: "newer", path: "/s/newer", project: "/p/one", firstMessage: "Newer task", modified: 2000 },
  );
  const metrics: RunMetrics[] = [];
  const hub = new SessionHub(source, { projects: ["/p/one", "/p/two"], idleMinutes }, (run) => metrics.push(run));
  const client = () => {
    const messages: any[] = [];
    return { messages, send: (message: string) => messages.push(JSON.parse(message)) };
  };
  return { source, hub, metrics, client };
}

test("lists sessions by project, newest first, and merges open unsaved sessions", async (context) => {
  const { hub } = setup();
  context.after(() => hub.close());
  const id = await hub.createSession("/p/two");
  const { projects } = await hub.getSessionList();
  assert.deepEqual(projects.map((project) => project.sessions.map((session) => session.id)), [["newer", "old"], [id]]);
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
  assert.deepEqual(second.messages[0].runEvents.map((event: any) => event.type), ["agent_start"]);
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
