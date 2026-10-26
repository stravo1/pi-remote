import assert from "node:assert/strict";
import { test } from "node:test";
import { preview } from "vite";
import { chromium } from "playwright";

const session = { id: "one", name: "Long", firstMessage: "Hi", modified: 1, isRunning: false };
const messages = Array.from({ length: 150 }, (_, index) => ({
  role: index % 2 ? "assistant" : "user",
  content: [{ type: "text", text: `Message ${index}` }],
  timestamp: index,
}));

test(
  "a long session renders its last messages first and earlier ones on scroll",
  { timeout: 30_000 },
  async (context) => {
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
    await page.routeWebSocket("**/ws", (socket) => {
      socket.onMessage((raw) => {
        const command = JSON.parse(String(raw));
        const reply = (message: object) => socket.send(JSON.stringify(message));
        if (command.type === "list_sessions")
          reply({ type: "sessions", projects: [{ path: "/p", sessions: [session] }] });
        if (command.type === "subscribe")
          reply({
            type: "snapshot",
            sessionId: "one",
            seq: 0,
            messages,
            runEvents: [],
            isStreaming: false,
            isCompacting: false,
            queue: { steering: [], followUp: [] },
          });
      });
    });
    await page.goto(`${server.resolvedUrls!.local[0]}#one`);
    const conversation = page.getByRole("region", { name: "Conversation" });
    await page.getByText("Message 149").waitFor();
    assert.equal(await conversation.locator("article").count(), 60);
    assert.equal(await page.getByText("Message 89", { exact: true }).count(), 0);

    const first = page.getByText("Message 90", { exact: true });
    await conversation.evaluate((element) => (element.scrollTop = 0));
    await page.getByText("Message 89", { exact: true }).waitFor();
    const top = await first.evaluate((element) => element.getBoundingClientRect().top);
    assert.ok(top > 0, "The messages that were on screen stay in place.");

    await conversation.evaluate((element) => (element.scrollTop = 0));
    await page.getByText("Message 0", { exact: true }).waitFor();
    assert.equal(await conversation.locator("article").count(), 150);
  },
);
