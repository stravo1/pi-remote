import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { preview } from "vite";
import { chromium, type Page } from "playwright";

const settings = {
  model: { provider: "faux", id: "first", name: "First model" },
  models: [{ provider: "faux", id: "first", name: "First model" }],
  thinkingLevel: "off",
  thinkingLevels: ["off"],
  commands: [],
};

function bashCall(id: string, command: string) {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name: "bash", arguments: { command } }],
  };
}

function bashResult(id: string) {
  return { role: "toolResult", toolCallId: id, isError: false, content: [{ type: "text", text: `${id} done` }] };
}

// Opens the app on a session whose transcript holds long runs of tool calls.
async function openApp(context: TestContext, width: number): Promise<Page> {
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
  const page = await browser.newPage({ viewport: { width, height: 812 }, hasTouch: width === 375 });
  page.setDefaultTimeout(5000);
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      if (command.type === "list_sessions")
        socket.send(
          JSON.stringify({
            type: "sessions",
            projects: [{ path: "/code/example", sessions: [{ id: "one", firstMessage: "Checks", modified: 1 }] }],
          }),
        );
      if (command.type === "subscribe")
        socket.send(
          JSON.stringify({
            type: "snapshot",
            sessionId: "one",
            seq: 0,
            isStreaming: false,
            settings,
            queue: { steering: [], followUp: [] },
            runEvents: [],
            messages: [
              { role: "user", content: "Run the checks" },
              {
                role: "assistant",
                content: [
                  { type: "thinking", thinking: "I will run the checks in order." },
                  { type: "toolCall", id: "one", name: "bash", arguments: { command: "npm test" } },
                ],
              },
              bashResult("one"),
              bashCall("two", "npm run check"),
              bashResult("two"),
              bashCall("three", "git status --short"),
              bashResult("three"),
              // Two calls in a row stay open, because that is not a long sequence.
              bashCall("four", "ls"),
              bashResult("four"),
              bashCall("five", "pwd"),
              bashResult("five"),
              { role: "assistant", content: [{ type: "text", text: "All checks passed." }] },
              // A run long enough that its expanded list scrolls past the viewport.
              ...Array.from({ length: 30 }, (_, index) => [
                bashCall(`long-${index}`, `echo ${index}`),
                bashResult(`long-${index}`),
              ]).flat(),
            ],
          }),
        );
    });
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.getByRole("button", { name: /Checks/ }).click();
  return page;
}

for (const width of [375, 1280]) {
  test(`tool runs fold and expand at ${width}px`, { timeout: 30_000 }, async (context) => {
    const page = await openApp(context, width);

    const run = page.getByRole("button", { name: /Ran 3 commands/ });
    await run.waitFor();
    assert.equal(await run.getAttribute("aria-expanded"), "false");
    assert.equal(await page.getByRole("button", { name: /^bash / }).count(), 2, "Only the short run stays open");
    assert.equal(await page.getByText("Thinking", { exact: true }).count(), 0);

    await run.click();
    await page.getByText("npm test", { exact: true }).waitFor();
    assert.equal(await run.getAttribute("aria-expanded"), "true");
    for (const command of ["npm run check", "git status --short"]) {
      await page.getByText(command, { exact: true }).waitFor();
    }
    assert.equal(await page.getByRole("button", { name: /^bash / }).count(), 5);
    await page.getByText("Thinking", { exact: true }).waitFor();
    await page.getByText("I will run the checks in order.").waitFor();

    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "The folded run fits the screen width",
    );

    await run.click();
    await page.getByText("npm test", { exact: true }).waitFor({ state: "detached" });
  });

  test(`an expanded run keeps its header pinned at ${width}px`, { timeout: 30_000 }, async (context) => {
    const page = await openApp(context, width);
    const longRun = page.getByRole("button", { name: /Ran 30 commands/ });
    await longRun.click();
    await page.getByText("echo 29", { exact: true }).waitFor();

    const transcript = page.getByLabel("Conversation");
    const scroller = await transcript.elementHandle();
    const offset = await longRun.evaluate((button, element) => {
      const box = element as HTMLElement;
      return button.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    }, scroller);
    await transcript.evaluate((element, top) => element.scrollTo({ top }), offset + 200);
    await page.evaluate(() => new Promise(requestAnimationFrame));

    const pinned = (await longRun.boundingBox())!;
    const viewport = (await transcript.boundingBox())!;
    assert.ok(
      Math.abs(pinned.y - viewport.y) <= 1,
      `The run header sticks to the top of the view, not ${pinned.y - viewport.y}px away`,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "The pinned header does not widen the page",
    );
  });
}
