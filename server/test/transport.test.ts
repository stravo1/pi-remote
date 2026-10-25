import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { WebSocket } from "ws";
import type { Configuration } from "../src/config.ts";
import type { AgentSessionEvent } from "../src/pi-adapter.ts";
import { Transport, type RunMetrics } from "../src/transport.ts";

class ScriptedSession {
  id = "test-session";
  is_running = false;
  listener: (event: AgentSessionEvent) => void = () => {};
  finish: () => void = () => {};

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listener = listener;
    return () => { this.listener = () => {}; };
  }

  async prompt(): Promise<void> {
    if (this.is_running) throw new Error("A run is already active.");
    this.is_running = true;
    this.listener({ type: "agent_start" });
    await new Promise<void>((resolve) => { this.finish = resolve; });
    this.listener({ type: "agent_settled", aborted: false });
    this.is_running = false;
  }
}

async function setup(context: TestContext, pingInterval = 10_000) {
  const directory = await mkdtemp(join(tmpdir(), "pi-remote-transport-"));
  const adapter = new ScriptedSession();
  const metrics: RunMetrics[] = [];
  const configuration: Configuration = {
    host: "127.0.0.1", port: 7710, origin: "https://pi.example.com",
    allowedUser: "me", projects: [directory], idleMinutes: 30,
  };
  const transport = new Transport(adapter, configuration, directory, pingInterval, (run) => metrics.push(run));
  context.after(async () => {
    adapter.finish();
    await transport.close();
    await rm(directory, { recursive: true, force: true });
  });
  transport.server.listen(0, "127.0.0.1");
  await once(transport.server, "listening");
  const address = transport.server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  return { directory, adapter, transport, metrics, url };
}

async function connect(url: string, options = {}) {
  const socket = new WebSocket(`${url}/ws`, {
    origin: "https://pi.example.com", headers: { "Remote-User": "me" }, ...options,
  });
  await once(socket, "open");
  return socket;
}

test("two clients receive the same sequence, reject a busy prompt, and count wire bytes", { timeout: 5000 }, async (context) => {
  const { url, adapter, metrics } = await setup(context);
  const first = await connect(url);
  const second = await connect(url);
  const firstEvents: string[] = [];
  const secondEvents: string[] = [];
  first.on("message", (data) => {
    if (JSON.parse(data.toString()).type === "event") firstEvents.push(data.toString());
  });
  second.on("message", (data) => {
    if (JSON.parse(data.toString()).type === "event") secondEvents.push(data.toString());
  });
  const start = once(second, "message");
  first.send(JSON.stringify({ type: "prompt", text: "Hello" }));
  await start;
  const busy = once(second, "message");
  second.send(JSON.stringify({ type: "prompt", text: "Too soon" }));
  assert.match(JSON.parse((await busy)[0].toString()).message, /already active/);
  const settled = Promise.all([once(first, "message"), once(second, "message")]);
  adapter.finish();
  await settled;
  assert.deepEqual(firstEvents, secondEvents);
  assert.deepEqual(firstEvents.map((item) => JSON.parse(item).seq), [1, 2]);
  assert.equal(JSON.parse(firstEvents[1]).event.type, "agent_settled");
  assert.deepEqual(metrics, [{
    type: "run", sessionId: adapter.id, eventCount: 2,
    bytes: [...firstEvents, ...secondEvents].reduce((sum, item) => sum + Buffer.byteLength(item), 0),
  }]);
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
  for (const command of ["not json", "null", '{"type":"abort"}', '{"type":"prompt","text":" "}',
    '{"type":"prompt","sessionId":"wrong","text":"hello"}']) {
    const reply = once(socket, "message");
    socket.send(command);
    assert.equal(JSON.parse((await reply)[0].toString()).type, "error");
    assert.equal(socket.readyState, WebSocket.OPEN);
  }
});
