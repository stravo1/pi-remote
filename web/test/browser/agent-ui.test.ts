import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preview } from "vite";
import { chromium, type Locator, type Page, type WebSocketRoute } from "playwright";

const settings = {
  model: { provider: "faux", id: "first", name: "First model" },
  models: [{ provider: "faux", id: "first", name: "First model" }, { provider: "other", id: "reasoner", name: "Second model" }],
  thinkingLevel: "off", thinkingLevels: ["off", "high"],
};

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail("The UI did not reach the expected state.");
  });
}

async function checkWidth(page: Page): Promise<void> {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

async function getFontSize(locator: Locator): Promise<number> {
  return locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
}

async function screenshot(page: Page, name: string): Promise<void> {
  const directory = join(tmpdir(), "pi-remote-phase-3");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), animations: "disabled" });
}

for (const width of [375, 1280]) {
  test(`agent UI at ${width}px`, { timeout: 30_000 }, async (context) => {
    const server = await preview({ server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1", port: 0 } });
    context.after(() => {
      if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
      return new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    });
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
    context.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 812 }, hasTouch: width === 375 });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let socket: WebSocketRoute;
    let sequence = 0;
    const state = structuredClone(settings);
    state.models.push(...Array.from({ length: 60 }, (_, index) => ({
      provider: "faux", id: `extra-${index}`, name: `Extra model ${index} with a very long name that should stay within the drawer`,
    })));
    const commands: any[] = [];
    let isRunning = false;
    const snapshot = () => socket.send(JSON.stringify({
      type: "snapshot", sessionId: "one", seq: sequence, isStreaming: isRunning, settings: state,
      queue: { steering: [], followUp: [] }, runEvents: [], messages: [
        { role: "user", content: "Update the example" },
        { role: "assistant", content: [{ type: "text", text: "**Updated**\n```ts\nconst answer = 42;\n```" },
          { type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "src/example.ts", oldText: "old", newText: "new" } }] },
        { role: "toolResult", toolCallId: "edit-1", isError: false, content: [{ type: "text", text: "Changed file" }],
          details: { diff: `-1 old\n+1 ${"long line ".repeat(20)}` } },
      ],
    }));
    const event = (value: object) => socket.send(JSON.stringify({ type: "event", sessionId: "one", seq: ++sequence, event: value }));
    await page.routeWebSocket("**/ws", (route) => {
      socket = route;
      route.onMessage((raw) => {
        const command = JSON.parse(String(raw));
        commands.push(command);
        if (command.type === "list_sessions") route.send(JSON.stringify({ type: "sessions", groupsRoot: "/code", projects: [{ path: "/code/example", sessions: [{ id: "one", firstMessage: "Example", modified: 1, isRunning }] }] }));
        if (command.type === "subscribe") snapshot();
        if (command.type === "set_model") { state.model = state.models.find((model) => model.id === command.modelId)!; snapshot(); }
        if (command.type === "set_thinking_level") { state.thinkingLevel = command.level; snapshot(); }
        if (command.type === "prompt") { isRunning = true; event({ type: "agent_start" }); }
        if (command.type === "follow_up" && command.text !== "Change direction") event({ type: "queue_update", steering: [], followUp: [command.text] });
        if (command.type === "follow_up" && command.text === "Change direction") event({ type: "queue_update", steering: [], followUp: ["Next task", command.text] });
        if (command.type === "steer_follow_up") event({ type: "queue_update", steering: [command.text], followUp: ["Next task", "Third", "Fourth"] });
        if (command.type === "new_group" && command.name === "taken") route.send(JSON.stringify({ type: "error", message: "Folder exists." }));
        if (command.type === "remove_group") route.send(JSON.stringify({ type: "sessions", groupsRoot: "/code", projects: [] }));
        if (command.type === "abort") { isRunning = false; event({ type: "agent_settled", aborted: true }); }
      });
    });
    const address = server.httpServer.address();
    assert.ok(address && typeof address === "object");
    await page.goto(`http://127.0.0.1:${address.port}/`);
    assert.match(await page.locator("meta[name=viewport]").getAttribute("content") ?? "", /maximum-scale=1/);
    await page.getByRole("button", { name: /Example/ }).click();
    await page.getByText("File diff", { exact: true }).waitFor();
    assert.equal(await page.locator(".hljs-keyword").textContent(), "const");
    assert.equal(await page.getByText("Changed file").count(), 0);
    await page.getByRole("button", { name: /edit/ }).click();
    await page.getByText("Changed file").waitFor();
    const toolRow = page.getByRole("button", { name: /edit/ });
    const rowCenters = await toolRow.locator(":scope > span").evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top + bounds.height / 2;
    }));
    const alignedCenters = width === 375 ? rowCenters.slice(0, 4) : rowCenters;
    assert.ok(Math.max(...alignedCenters) - Math.min(...alignedCenters) <= 1, "Tool row controls align vertically");
    await checkWidth(page);
    await page.getByRole("button", { name: "Session settings", exact: true }).click();
    const dialog = page.locator("[data-session-settings]");
    await dialog.waitFor();
    const drawerHeight = await dialog.evaluate((element) => element.getBoundingClientRect().height);
    if (width === 375) {
      const bottomSpace = await dialog.evaluate((element) => {
        const footer = element.lastElementChild!;
        return element.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom;
      });
      assert.ok(bottomSpace <= 20, "The initial drawer has no extra space below its content");
    }
    const checkDrawerHeight = async () => {
      if (width === 375) assert.equal(await dialog.evaluate((element) => element.getBoundingClientRect().height), drawerHeight);
    };
    await checkWidth(page);
    await screenshot(page, `settings-${width}`);
    await dialog.getByRole("button", { name: "More models" }).click();
    await checkDrawerHeight();
    await screenshot(page, `model-picker-${width}`);
    await checkWidth(page);
    if (width === 375) assert.ok(await getFontSize(page.getByPlaceholder("Search models")) >= 16);
    await page.getByPlaceholder("Search models").fill("reasoner");
    await checkDrawerHeight();
    assert.equal(await page.getByRole("option").count(), 1);
    await page.getByRole("option", { name: /Second model/ }).click();
    await waitFor(async () => state.model.id === "reasoner");
    await dialog.getByRole("button", { name: /^Effort/ }).click();
    await checkDrawerHeight();
    await page.getByRole("option", { name: "high", exact: true }).click();
    await waitFor(async () => state.thinkingLevel === "high");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    if (width === 375) assert.ok(await getFontSize(page.getByRole("textbox", { name: "Message", exact: true })) >= 16);
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Start work");
    await page.getByRole("button", { name: "Send prompt" }).click();
    await page.getByRole("button", { name: "Stop run" }).waitFor();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Next task");
    await page.getByRole("button", { name: "Send follow-up" }).click();
    await page.getByLabel("Queued messages").waitFor();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Change direction");
    await page.getByRole("button", { name: "Send follow-up" }).click();
    await page.getByRole("listitem").filter({ hasText: "Change direction" }).getByRole("button", { name: "Send now" }).click();
    await waitFor(async () => commands.some((command) => command.type === "steer_follow_up" && command.text === "Change direction"));
    await page.getByRole("img", { name: "After the current turn" }).waitFor();
    const queueSize = await page.getByLabel("Queued messages").evaluate((list) => ({ visible: list.clientHeight, rows: [...list.children].slice(0, 3).reduce((sum, row) => sum + row.getBoundingClientRect().height, 0) }));
    assert.ok(Math.abs(queueSize.visible - queueSize.rows) <= 2, `The queue shows ${queueSize.visible}px for three rows of ${queueSize.rows}px.`);
    await checkWidth(page);
    await screenshot(page, `agent-${width}`);
    await page.getByRole("button", { name: "Stop run" }).click();
    await page.getByRole("button", { name: "Send prompt" }).waitFor();
    await page.getByRole("button", { name: "All sessions" }).click();
    await page.getByRole("button", { name: /Example/ }).waitFor();
    await page.getByRole("button", { name: "example", exact: true }).click();
    await page.getByRole("button", { name: /Example/ }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "example", exact: true }).click();
    await page.getByRole("button", { name: /Example/ }).waitFor();
    await page.getByRole("button", { name: "New project" }).click();
    await waitFor(async () => page.getByRole("textbox", { name: "Folder name" }).evaluate((input) => input === document.activeElement));
    await page.getByRole("textbox", { name: "Folder name" }).fill("taken");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByText("Folder exists.", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Folder name" }).fill("notes");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await waitFor(async () => commands.some((command) => command.type === "new_group" && command.name === "notes"));
    await screenshot(page, `sessions-${width}`);
    await page.getByRole("button", { name: "Delete example" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete folder" }).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Remove from list" }).click();
    await page.getByText("No projects found.", { exact: true }).waitFor();
    assert.ok(commands.some((command) => command.type === "remove_group" && command.project === "/code/example" && command.deleteFolder === false));
    assert.deepEqual(errors, []);
  });
}
