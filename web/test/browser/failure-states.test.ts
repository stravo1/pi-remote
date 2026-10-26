import assert from "node:assert/strict";
import { test } from "node:test";
import { preview } from "vite";
import { chromium, type Page, type WebSocketRoute } from "playwright";

const settings = {
  model: { provider: "faux", id: "first", name: "First model" },
  models: [{ provider: "faux", id: "first", name: "First model" }],
  thinkingLevel: "off", thinkingLevels: ["off"],
};

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("The UI did not reach the expected state.");
}

function sendSnapshot(socket: WebSocketRoute): void {
  socket.send(JSON.stringify({
    type: "snapshot", sessionId: "one", seq: 0, isStreaming: false,
    settings, queue: { steering: [], followUp: [] }, runEvents: [], messages: [],
  }));
}

test("the browser shows server errors, reconnects after a disconnect, and reloads expired logins", { timeout: 30_000 }, async (context) => {
  const server = await preview({ server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1", port: 0 } });
  context.after(() => {
    if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
    return new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  context.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket("**/ws", (socket) => {
    sockets.push(socket);
    socket.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      if (command.type === "list_sessions") {
        socket.send(JSON.stringify({ type: "sessions", projects: [{ path: "/code/example", sessions: [
          { id: "one", firstMessage: "Example", modified: 1, isRunning: false },
        ] }] }));
      }
      if (command.type === "subscribe") sendSnapshot(socket);
      if (command.type === "prompt") {
        socket.send(JSON.stringify({ type: "error", sessionId: "one", message: "The server refused the request." }));
      }
    });
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.getByRole("button", { name: /Example/ }).click();

  await page.getByRole("textbox", { name: "Message" }).fill("Start work");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await page.getByRole("alert").getByText("The server refused the request.").waitFor();

  await sockets[0].close();
  await page.getByRole("heading", { name: "Reconnecting…" }).waitFor();
  await waitFor(async () => sockets.length === 2);
  await page.getByRole("heading", { name: "Example" }).waitFor();

  await page.route("**/api/ping", (route) => route.fulfill({ status: 403 }));
  const ping = page.waitForRequest("**/api/ping");
  const reload = page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame());
  await sockets[1].close();
  await ping;
  await reload;
});
