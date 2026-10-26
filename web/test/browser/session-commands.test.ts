import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { preview } from "vite";
import { chromium } from "playwright";

const session = { id: "one", name: "Old name", firstMessage: "Hi", modified: 1, isRunning: false };
const info = {
  sessionId: "one",
  userMessages: 2,
  assistantMessages: 3,
  toolCalls: 4,
  toolResults: 4,
  totalMessages: 9,
  tokens: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, total: 1500 },
  cost: 0.0123,
  contextUsage: { tokens: 1500, contextWindow: 100000, percent: 1.5 },
};

async function open(context: TestContext, hash: string, pushKey: string | null, isPushSupported = true) {
  const server = await preview({ server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1", port: 0 } });
  context.after(() => {
    if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
    return new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
  page.setDefaultTimeout(5000);
  // iOS Safari outside the Home Screen app has no PushManager.
  if (!isPushSupported) await page.addInitScript(() => delete (window as { PushManager?: unknown }).PushManager);
  const commands: any[] = [];
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      commands.push(command);
      const reply = (message: object) => socket.send(JSON.stringify(message));
      if (command.type === "list_sessions")
        reply({ type: "sessions", projects: [{ path: "/p", sessions: [session] }] });
      if (command.type === "list_providers") reply({ type: "providers", providers: [] });
      if (command.type === "get_push_key") reply({ type: "push_key", publicKey: pushKey });
      if (command.type === "get_session_info") reply({ type: "session_info", sessionId: "one", info });
      if (command.type === "subscribe")
        reply({
          type: "snapshot",
          sessionId: "one",
          seq: 0,
          messages: [],
          runEvents: [],
          isStreaming: false,
          isCompacting: false,
          queue: { steering: [], followUp: [] },
        });
    });
  });
  await page.goto(`${server.resolvedUrls!.local[0]}#${hash}`);
  return { page, commands };
}

test("slash commands rename, compact, and show usage as a note", { timeout: 30_000 }, async (context) => {
  const { page, commands } = await open(context, "one", null);
  const message = page.getByRole("textbox", { name: "Message" });
  for (const text of ["/name New name", "/compact Keep the plan", "/session"]) {
    await message.fill(text);
    await page.getByRole("button", { name: "Send prompt" }).click();
  }
  await page.getByText("$0.0123").waitFor();
  await page.getByText("1,500 of 100,000 (2%)").waitFor();
  assert.deepEqual(
    commands.filter((command) => ["rename_session", "compact", "get_session_info"].includes(command.type)),
    [
      { type: "rename_session", sessionId: "one", name: "New name" },
      { type: "compact", sessionId: "one", instructions: "Keep the plan" },
      { type: "get_session_info", sessionId: "one" },
    ],
  );
});

test("settings explain why push is off on a server without push", { timeout: 30_000 }, async (context) => {
  const { page } = await open(context, "settings", null);
  await page.getByText("Push notifications").waitFor();
  await page.getByText("Push is not set up on this server").waitFor();
  assert.equal(await page.getByRole("switch", { name: "Push notifications" }).isDisabled(), true);
});

test("turning on push outside the Home Screen app explains how in a toast", { timeout: 30_000 }, async (context) => {
  const { page, commands } = await open(context, "settings", "key", false);
  await page.getByRole("switch", { name: "Push notifications" }).click();
  await page.getByText("add pi remote to the Home Screen").waitFor();
  assert.equal(await page.getByRole("switch", { name: "Push notifications" }).isChecked(), false);
  assert.equal(
    commands.some((command) => command.type === "push_subscribe"),
    false,
  );
});

test("the composer suggests slash commands and fills the chosen one", { timeout: 30_000 }, async (context) => {
  const { page } = await open(context, "one", null);
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("/co");
  await page.getByRole("option", { name: /\/compact/ }).click();
  assert.equal(await message.inputValue(), "/compact ");
  assert.equal(await page.getByRole("listbox", { name: "Commands" }).count(), 0);
});
