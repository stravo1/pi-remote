import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preview } from "vite";
import { chromium, type Locator, type Page, type WebSocketRoute } from "playwright";

const settings = {
  model: { provider: "faux", id: "first", name: "First model", hasImageInput: true },
  models: [
    { provider: "faux", id: "first", name: "First model", hasImageInput: true },
    { provider: "other", id: "reasoner", name: "Second model", hasImageInput: true },
  ],
  thinkingLevel: "off",
  thinkingLevels: ["off", "high"],
  commands: [],
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
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    });
    context.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 812 }, hasTouch: width === 375 });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let socket: WebSocketRoute;
    let sequence = 0;
    const state = structuredClone(settings);
    state.models.push(
      ...Array.from({ length: 60 }, (_, index) => ({
        provider: "faux",
        id: `extra-${index}`,
        name: `Extra model ${index} with a very long name that should stay within the drawer`,
        hasImageInput: false,
      })),
    );
    const commands: any[] = [];
    const queuedEntries = new Map<string, { id: string; text: string; images: { data: string; mimeType: string }[] }>();
    let queuedCount = 0;
    // The server echoes a queued message back with the images it carries.
    const queued = (text: string, images: { data: string; mimeType: string }[] = []) => {
      const existing = queuedEntries.get(text);
      if (existing) return existing;
      const entry = { id: `queued-${++queuedCount}`, text, images };
      queuedEntries.set(text, entry);
      return entry;
    };
    let isRunning = false;
    const snapshot = () =>
      socket.send(
        JSON.stringify({
          type: "snapshot",
          sessionId: "one",
          seq: sequence,
          isStreaming: isRunning,
          settings: state,
          queue: { steering: [], followUp: [] },
          runEvents: [],
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Update the example" },
                { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
              ],
            },
            {
              role: "assistant",
              content: [
                { type: "text", text: "**Updated**\n```ts\nconst answer = 42;\n```" },
                {
                  type: "toolCall",
                  id: "edit-1",
                  name: "edit",
                  arguments: { path: "src/example.ts", oldText: "old", newText: "new" },
                },
              ],
            },
            {
              role: "toolResult",
              toolCallId: "edit-1",
              isError: false,
              content: [{ type: "text", text: "Changed file" }],
              details: { diff: `-1 old\n+1 ${"long line ".repeat(20)}` },
            },
            {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  id: "bash-1",
                  name: "bash",
                  arguments: {
                    command: `grep -rn "formats" ${"/home/ubuntu/searxng/src/searx/settings.yml ".repeat(4)}| head`,
                  },
                },
              ],
            },
            {
              role: "toolResult",
              toolCallId: "bash-1",
              isError: false,
              content: [{ type: "text", text: "formats: [html, json]" }],
            },
          ],
        }),
      );
    const event = (value: object) =>
      socket.send(JSON.stringify({ type: "event", sessionId: "one", seq: ++sequence, event: value }));
    await page.routeWebSocket("**/ws", (route) => {
      socket = route;
      route.onMessage((raw) => {
        const command = JSON.parse(String(raw));
        commands.push(command);
        // The first list and snapshot arrive late, so the loading states are visible.
        const delay = (type: string) => (commands.filter((item) => item.type === type).length === 1 ? 300 : 0);
        if (command.type === "list_sessions")
          setTimeout(
            () =>
              route.send(
                JSON.stringify({
                  type: "sessions",
                  groupsRoot: "/code",
                  projects: [
                    {
                      path: "/code/example",
                      sessions: [
                        { id: "one", firstMessage: "Example", modified: 1, isRunning },
                        ...Array.from({ length: 15 }, (_, index) => ({
                          id: `older-${index}`,
                          firstMessage: `Older task ${index}`,
                          modified: 0,
                          isRunning: false,
                        })),
                      ],
                    },
                  ],
                }),
              ),
            delay("list_sessions"),
          );
        if (command.type === "subscribe") setTimeout(snapshot, delay("subscribe"));
        if (command.type === "set_model") {
          state.model = state.models.find((model) => model.id === command.modelId)!;
          snapshot();
        }
        if (command.type === "set_thinking_level") {
          state.thinkingLevel = command.level;
          snapshot();
        }
        if (command.type === "prompt") {
          isRunning = true;
          event({ type: "agent_start" });
        }
        if (command.type === "follow_up" && !["Change direction", "Fourth"].includes(command.text))
          event({ type: "queue_update", steering: [], followUp: [queued(command.text, command.images)] });
        if (command.type === "follow_up" && command.text === "Change direction")
          event({
            type: "queue_update",
            steering: [],
            followUp: [queued("Next task"), queued(command.text, command.images)],
          });
        if (command.type === "steer_follow_up") {
          const promoted = [...queuedEntries.values()].find((entry) => entry.id === command.id) ?? {
            id: command.id,
            text: "Unknown message",
            images: [],
          };
          event({ type: "queue_update", steering: [promoted], followUp: [queued("Next task"), queued("Third")] });
        }
        if (command.type === "follow_up" && command.text === "Fourth")
          event({
            type: "queue_update",
            steering: [queued("Change direction")],
            followUp: [queued("Next task"), queued("Third"), queued("Fourth")],
          });
        if (command.type === "new_group" && command.name === "taken")
          route.send(JSON.stringify({ type: "error", message: "Folder exists." }));
        if (command.type === "delete_sessions")
          route.send(
            JSON.stringify({
              type: "sessions",
              groupsRoot: "/code",
              projects: [{ path: "/code/example", sessions: [] }],
            }),
          );
        if (command.type === "remove_group")
          route.send(JSON.stringify({ type: "sessions", groupsRoot: "/code", projects: [] }));
        if (command.type === "abort") {
          isRunning = false;
          event({ type: "agent_settled", aborted: true });
        }
      });
    });
    const address = server.httpServer.address();
    assert.ok(address && typeof address === "object");
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole("region", { name: "Loading sessions" }).waitFor();
    assert.equal(await page.getByText("No projects found.").count(), 0);
    await page.getByRole("button", { name: /Example/ }).waitFor();
    if (width === 375) await page.getByRole("button", { name: "View all sessions" }).waitFor();
    assert.match((await page.locator("meta[name=viewport]").getAttribute("content")) ?? "", /maximum-scale=1/);
    await page.getByRole("button", { name: /Example/ }).click();
    await page.getByRole("status", { name: "Loading session" }).waitFor();
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    assert.equal(await message.isEditable(), true, "The message field stays editable while a session loads");
    await message.fill("Typed early");
    assert.equal(await page.getByRole("button", { name: "Send prompt" }).isDisabled(), true);
    await message.fill("");
    await page.getByText("File diff", { exact: true }).waitFor();
    const diffChannels = (text: string) =>
      page
        .locator("code", { hasText: text })
        .first()
        .evaluate((element) => {
          // Canvas normalises any colour syntax to rgb or hex.
          const canvas = document.createElement("canvas").getContext("2d")!;
          canvas.fillStyle = getComputedStyle(element).backgroundColor;
          const color = canvas.fillStyle;
          if (color.startsWith("#")) return [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
          return color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
        });
    const [added, removed] = [await diffChannels("+1 "), await diffChannels("-1 old")];
    assert.ok(added[1] > added[0], `Added lines are green, not rgb(${added})`);
    assert.ok(removed[0] > removed[1], `Removed lines are red, not rgb(${removed})`);
    const bashCall = page.getByRole("button", { name: /^bash grep/ });
    const bashHeight = (await bashCall.boundingBox())!.height;
    assert.ok(bashHeight < 48, `A long command stays on one line, not ${bashHeight}px`);
    await bashCall.click();
    await page.getByText("formats: [html, json]", { exact: true }).waitFor();
    await bashCall.click();
    const conversation = page.getByRole("region", { name: "Conversation" });
    const addMessage = async (text: string) => {
      const message = { role: "user", content: text };
      event({ type: "message_start", message });
      event({ type: "message_end", message });
      await page.getByText(text, { exact: true }).waitFor();
      await page.evaluate(() => new Promise(requestAnimationFrame));
    };
    const getScroll = () =>
      conversation.evaluate((element) => ({
        top: element.scrollTop,
        fromBottom: element.scrollHeight - element.scrollTop - element.clientHeight,
      }));
    for (let index = 0; index < 12; index++) await addMessage(`Filler message ${index} ${"text ".repeat(30)}`);
    assert.ok((await getScroll()).fromBottom < 2, "New content follows while the reader is at the bottom");
    const scrollTo = (place: "top" | "bottom") =>
      conversation.evaluate(async (element, place) => {
        element.scrollTo({ top: place === "top" ? 0 : element.scrollHeight });
        // The browser sends the scroll event on the next frame.
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }, place);
    await scrollTo("top");
    await addMessage("Arrives while reading above");
    assert.equal((await getScroll()).top, 0, "New content does not move a reader who scrolled up");
    await scrollTo("bottom");
    await addMessage("Arrives at the bottom");
    assert.ok((await getScroll()).fromBottom < 2, "Following resumes at the bottom");
    assert.equal(await page.locator(".hljs-keyword").textContent(), "const");
    assert.equal(await page.getByText("Changed file").count(), 0);
    await page.getByRole("button", { name: /edit/ }).click();
    await page.getByText("Changed file").waitFor();
    const toolRow = page.getByRole("button", { name: /edit/ });
    const rowCenters = await toolRow.locator(":scope > span").evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top + bounds.height / 2;
      }),
    );
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
      if (width !== 375) return;
      const height = await dialog.evaluate((element) => element.getBoundingClientRect().height);
      assert.ok(
        Math.abs(height - drawerHeight) < 1,
        `The drawer height holds, not ${height}px instead of ${drawerHeight}px`,
      );
    };
    await checkWidth(page);
    await screenshot(page, `settings-${width}`);
    await dialog.getByRole("button", { name: "More models" }).click();
    await checkDrawerHeight();
    await screenshot(page, `model-picker-${width}`);
    await checkWidth(page);
    if (width === 375) assert.ok((await getFontSize(page.getByPlaceholder("Search models"))) >= 16);
    if (width === 375) {
      // A swipe that starts on a model row belongs to the list's native scroll,
      // not to the grow-drawer gesture, which must leave it unprevented.
      const heightBeforeSwipe = await dialog.evaluate((element) => element.getBoundingClientRect().height);
      await dialog.evaluate((element) => {
        const row = element.querySelector('[role="listbox"][aria-label="Models"] [role="option"]')!;
        const touch = (y: number) => new Touch({ identifier: 1, target: row, clientX: 180, clientY: y });
        const send = (type: string, y: number) =>
          row.dispatchEvent(new TouchEvent(type, { touches: [touch(y)], bubbles: true, cancelable: true }));
        send("touchstart", 600);
        for (let y = 600; y >= 300; y -= 50) send("touchmove", y);
        send("touchend", 300);
      });
      assert.equal(
        await dialog.evaluate((element) => element.getBoundingClientRect().height),
        heightBeforeSwipe,
        "A swipe on a model row does not grow the drawer",
      );
    }
    await page.getByPlaceholder("Search models").fill("reasoner");
    await checkDrawerHeight();
    assert.equal(await page.getByRole("option").count(), 1);
    await page.getByRole("option", { name: /Second model/ }).click();
    await waitFor(async () => state.model.id === "reasoner");
    await dialog.getByRole("button", { name: /^Effort/ }).click();
    await checkDrawerHeight();
    await page.getByRole("option", { name: "high", exact: true }).click();
    await waitFor(async () => state.thinkingLevel === "high");
    if (width === 375) {
      assert.ok((await dialog.getByRole("listbox", { name: "Recent models" }).getByRole("option").count()) <= 3);
      const resized = await dialog.evaluate(async (element) => {
        const touch = (y: number) => new Touch({ identifier: 1, target: element, clientX: 100, clientY: y });
        const send = (type: string, touches: Touch[]) =>
          element.dispatchEvent(new TouchEvent(type, { touches, bubbles: true, cancelable: true }));
        send("touchstart", [touch(700)]);
        send("touchmove", [touch(100)]);
        send("touchend", []);
        await new Promise(requestAnimationFrame);
        return element.getBoundingClientRect().height;
      });
      assert.ok(resized > drawerHeight, "A drag up grows the drawer");
      assert.ok(Math.abs(resized - 812 * 0.6) <= 1, `The drawer stops at 60% of the screen, not ${resized}px`);
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    if (width === 375)
      assert.ok((await getFontSize(page.getByRole("textbox", { name: "Message", exact: true }))) >= 16);
    if (width === 375) {
      const rowHeight = (selector: string) =>
        page
          .locator(selector)
          .first()
          .evaluate((row) => row.getBoundingClientRect().height);
      assert.equal(await rowHeight("header > div"), 56);
      assert.equal(await rowHeight("form > div > div:last-child"), 56);
    }
    // The single line of the input shares a center line with the attach and send buttons.
    const composerRow = page.locator("form > div > div:last-child").first();
    const [inputBox, sendBox] = await Promise.all([
      composerRow.locator("textarea").boundingBox(),
      composerRow.locator('button[type="submit"]').boundingBox(),
    ]);
    assert.ok(inputBox && sendBox, "The composer shows the input and the send button");
    assert.equal(inputBox.height, sendBox.height, "The input and the send button are the same height");
    assert.ok(
      Math.abs(inputBox.y + inputBox.height / 2 - (sendBox.y + sendBox.height / 2)) <= 1,
      "The input text sits on the send button's center line",
    );
    await page.getByRole("img", { name: "Image in the conversation" }).waitFor();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const attach = async (name: string) => {
      await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: png });
      await page.getByRole("list", { name: "Attached images" }).getByRole("listitem").waitFor();
    };
    await attach("photo.png");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Start work");
    await page.getByRole("button", { name: "Send prompt" }).click();
    await waitFor(async () => commands.some((c) => c.type === "prompt" && c.images?.length === 1));
    await page.getByRole("list", { name: "Attached images" }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Stop run" }).waitFor();
    // The attach button stays while a run is active, and the image rides with the follow-up.
    await attach("queued.png");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Next task");
    // Wait for the draft to enable the send button, so both fills are the enabled ones.
    await waitFor(() =>
      page
        .getByRole("button", { name: "Send follow-up" })
        .evaluate((button) => !(button as HTMLButtonElement).disabled),
    );
    // Only the send button is a primary action; stop is secondary.
    const [stopFill, sendFill] = await Promise.all(
      ["Stop run", "Send follow-up"].map((name) =>
        page.getByRole("button", { name }).evaluate((button) => getComputedStyle(button).backgroundColor),
      ),
    );
    assert.notEqual(stopFill, sendFill, "The stop button is not a second primary button");
    await page.getByRole("button", { name: "Send follow-up" }).click();
    await waitFor(async () =>
      commands.some(
        (command) => command.type === "follow_up" && command.text === "Next task" && command.images?.length === 1,
      ),
    );
    await page.getByLabel("Queued messages").waitFor();
    const queuedRow = (text: string) => page.getByRole("listitem").filter({ hasText: text });
    await queuedRow("Next task").getByRole("img", { name: "Queued image 1" }).waitFor();
    await attach("steered.png");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Change direction");
    await page.getByRole("button", { name: "Send follow-up" }).click();
    await waitFor(async () =>
      commands.some(
        (command) =>
          command.type === "follow_up" && command.text === "Change direction" && command.images?.length === 1,
      ),
    );
    await queuedRow("Change direction").getByRole("button", { name: "Send now" }).click();
    await waitFor(async () => commands.some((command) => command.type === "steer_follow_up"));
    // The promoted message keeps its text and its image.
    await queuedRow("Change direction").getByRole("img", { name: "After the current turn" }).waitFor();
    await queuedRow("Change direction").getByRole("img", { name: "Queued image 1" }).waitFor();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Fourth");
    await page.getByRole("button", { name: "Send follow-up" }).click();
    await page.getByText("Fourth", { exact: true }).waitFor();
    await waitFor(async () =>
      page
        .getByLabel("Queued messages")
        .evaluate((list) => list.scrollTop + list.clientHeight >= list.scrollHeight - 1),
    );
    const queueSize = await page.getByLabel("Queued messages").evaluate((list) => ({
      visible: list.clientHeight,
      content: list.scrollHeight,
    }));
    assert.ok(
      queueSize.content > queueSize.visible,
      `The queue caps its height: ${queueSize.content}px of messages in ${queueSize.visible}px.`,
    );
    await checkWidth(page);
    await screenshot(page, `agent-${width}`);
    await page.getByRole("button", { name: "Stop run" }).click();
    await page.getByRole("button", { name: "Send prompt" }).waitFor();
    // Files dropped or pasted anywhere in the session attach to the composer.
    const dispatchImages = async (type: "drop" | "paste", fileName: string) =>
      page.evaluate(
        ({ type, fileName, bytes }) => {
          const file = new File([Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0))], fileName, {
            type: "image/png",
          });
          const transfer = new DataTransfer();
          transfer.items.add(file);
          if (type === "drop") {
            for (const eventName of ["dragenter", "dragover", "drop"])
              document.body.dispatchEvent(
                new DragEvent(eventName, { bubbles: true, cancelable: true, dataTransfer: transfer }),
              );
            return;
          }
          const event = new Event("paste", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "clipboardData", { value: transfer });
          document.body.dispatchEvent(event);
        },
        { type, fileName, bytes: png.toString("base64") },
      );
    const attached = page.getByRole("list", { name: "Attached images" }).getByRole("listitem");
    await dispatchImages("drop", "dropped.png");
    await attached.nth(0).waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .evaluate((input) => input === document.activeElement),
      true,
      "A drop focuses the composer",
    );
    await dispatchImages("paste", "pasted.png");
    await waitFor(async () => (await attached.count()) === 2);
    await page.getByRole("button", { name: "All sessions" }).click();
    await page.getByRole("button", { name: /Example/ }).waitFor();
    if (width === 375) {
      await page.getByRole("button", { name: "View all sessions" }).click();
      await page.getByRole("button", { name: /Older task 5/ }).waitFor();
      await page.getByRole("button", { name: "All sessions" }).click();
      await page.getByRole("button", { name: /Example/ }).waitFor();
    }
    await page.getByRole("button", { name: "example", exact: true }).click();
    await page.getByRole("button", { name: /Example/ }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "example", exact: true }).click();
    await page.getByRole("button", { name: /Example/ }).waitFor();
    await page.getByRole("button", { name: "New project" }).click();
    await waitFor(async () =>
      page.getByRole("textbox", { name: "Folder name" }).evaluate((input) => input === document.activeElement),
    );
    await page.getByRole("textbox", { name: "Folder name" }).fill("taken");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByText("Folder exists.", { exact: true }).waitFor();
    const toastTop = await page
      .getByText("Folder exists.", { exact: true })
      .evaluate((toast) => toast.getBoundingClientRect().top);
    assert.ok(
      width === 375 ? toastTop < 120 : toastTop > 600,
      `The toast shows at the ${width === 375 ? "top" : "bottom"}`,
    );
    await page.getByRole("textbox", { name: "Folder name" }).fill("notes");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await waitFor(async () => commands.some((command) => command.type === "new_group" && command.name === "notes"));
    await screenshot(page, `sessions-${width}`);
    const row = page.getByRole("button", { name: /Example/ });
    if (width === 375) {
      // A real finger lift sends pointerup and then a click on the row.
      const longPress = async (target: Locator) => {
        // Putting a project back on the list can leave the newest chat below the fold.
        await target.scrollIntoViewIfNeeded();
        const handle = (await target.elementHandle())!;
        const touch = { pointerType: "touch", isPrimary: true, button: 0 };
        await handle.dispatchEvent("pointerdown", touch);
        await page.waitForTimeout(500);
        await handle.dispatchEvent("pointerup", touch);
        await handle.dispatchEvent("click");
      };
      const expectMenuNextTo = async (target: Locator, side: "below" | "above") => {
        await page.getByRole("menu").waitFor();
        assert.equal(await page.getByRole("menu").count(), 1, "Only one menu is open");
        const rowBox = (await target.boundingBox())!;
        const menuBox = (await page.getByRole("menu").boundingBox())!;
        assert.ok(Math.abs(menuBox.x - rowBox.x) < 12, "The menu lines up with the row's left edge");
        const gap = side === "below" ? menuBox.y - (rowBox.y + rowBox.height) : rowBox.y - (menuBox.y + menuBox.height);
        assert.ok(Math.abs(gap) < 24, `The menu opens ${side} the row`);
      };
      const older = page.getByRole("button", { name: /Older task 0/ });
      await longPress(older);
      await expectMenuNextTo(older, "below");
      assert.equal(await page.getByText("1 selected").count(), 0, "The release click does not open the session");
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "detached" });
      await longPress(row);
      await expectMenuNextTo(row, "below");
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "detached" });
      await longPress(row);
    } else await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Select" }).click();
    await page.getByText("1 selected", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "New session" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Delete example" }).isDisabled(), true);
    await row.click();
    await page.getByText("0 selected", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Delete selected sessions" }).isDisabled(), true);
    await row.click();
    await page.getByRole("button", { name: "Delete selected sessions" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await page.getByText("No sessions yet.", { exact: true }).waitFor();
    assert.ok(commands.some((command) => command.type === "delete_sessions" && command.sessionIds.join() === "one"));
    await page.getByRole("button", { name: "Delete example" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete folder" }).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Remove from list" }).click();
    await page.getByText("No projects found.", { exact: true }).waitFor();
    assert.ok(
      commands.some(
        (command) =>
          command.type === "remove_group" && command.project === "/code/example" && command.deleteFolder === false,
      ),
    );
    assert.deepEqual(errors, []);
  });
}
