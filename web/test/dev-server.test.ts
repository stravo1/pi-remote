import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import type { Configuration } from "../../server/src/config.ts";
import { SessionHub } from "../../server/src/session-hub.ts";
import { Transport } from "../../server/src/transport.ts";
import { FakeSource } from "../../server/test/fake-source.ts";

async function getFreePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForProxy(url: string, getOutput: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 204);
      return;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      await setTimeout(100);
    }
  }
  throw new Error(`The development proxy did not become ready: ${getOutput()}`);
}

test("the UI dev command proxies HTTP and authenticated WebSockets while preserving Origin checks", { timeout: 25_000 }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-remote-dev-test-"));
  const configuration: Configuration = {
    host: "127.0.0.1", port: 7710, origin: `http://127.0.0.1:${await getFreePort()}`,
    allowedUser: "local-test-user", projects: [directory], idleMinutes: 30,
  };
  const source = new FakeSource();
  source.stored.push({ id: "stored", path: "/s/stored", project: directory, firstMessage: "Hello", modified: 1 });
  const hub = new SessionHub(source, configuration, () => {});
  const transport = new Transport(hub, configuration, directory, 10_000);
  transport.server.listen(0, configuration.host);
  await once(transport.server, "listening");
  const address = transport.server.address();
  assert.ok(address && typeof address === "object");
  configuration.port = address.port;
  const path = join(directory, "configuration.json");
  await writeFile(path, JSON.stringify(configuration));
  const child = spawn(process.execPath, ["dev.ts", path], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const clients: WebSocket[] = [];
  context.after(async () => {
    for (const client of clients) client.terminate();
    if (child.exitCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
    await hub.close();
    await transport.close();
    await rm(directory, { recursive: true, force: true });
  });
  await waitForProxy(configuration.origin, () => output);
  const page = await fetch(configuration.origin);
  assert.match(await page.text(), /\/src\/main.ts/);
  const url = `${configuration.origin.replace("http:", "ws:")}/ws`;
  const socket = new WebSocket(url, { origin: configuration.origin });
  clients.push(socket);
  await once(socket, "open");
  const events: string[] = [];
  const settled = new Promise<void>((resolve) => socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    events.push(message.type === "event" ? message.event.type : message.type);
    if (message.type === "snapshot") {
      socket.send(JSON.stringify({ type: "prompt", sessionId: "stored", text: "A development prompt" }));
    }
    if (message.event?.type === "agent_start") source.sessions.get("stored")!.finish();
    if (message.event?.type === "agent_settled") resolve();
  }));
  socket.send(JSON.stringify({ type: "subscribe", sessionId: "stored" }));
  await settled;
  assert.deepEqual(events, ["snapshot", "agent_start", "agent_settled"]);
  const denied = new WebSocket(url, { origin: "https://other.example.com" });
  clients.push(denied);
  await assert.rejects(once(denied, "open"), /403/);
});
