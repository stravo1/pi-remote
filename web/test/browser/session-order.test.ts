import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { type Page } from "playwright";
import { browserSkipReason, getPreviewServer, launchBrowser } from "../support/browser.ts";

const projects = [
  {
    path: "/code/many",
    sessions: [
      { id: "many-new", firstMessage: "Newest chat", modified: 1300, lastUserMessage: 1300, isRunning: false },
      { id: "many-second", firstMessage: "Second chat", modified: 1200, lastUserMessage: 1200, isRunning: false },
      { id: "many-third", firstMessage: "Third chat", modified: 1100, lastUserMessage: 1100, isRunning: false },
      { id: "many-old", firstMessage: "Oldest chat", modified: 1000, lastUserMessage: 1000, isRunning: false },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `many-f${index}`,
        firstMessage: `Earlier chat ${12 - index}`,
        modified: 990 - index,
        lastUserMessage: 990 - index,
        isRunning: false,
      })),
    ],
  },
  {
    path: "/code/running",
    sessions: [{ id: "running", firstMessage: "Running chat", modified: 1000, lastUserMessage: 100, isRunning: true }],
  },
  { path: "/code/empty", sessions: [] },
  {
    path: "/code/prompted",
    sessions: [
      {
        id: "prompted-old",
        firstMessage: "Older prompted chat",
        modified: 200,
        lastUserMessage: 200,
        isRunning: false,
      },
      {
        id: "prompted-new",
        firstMessage: "Last active chat",
        modified: 900,
        lastUserMessage: 900,
        isRunning: false,
      },
    ],
  },
];

const desktopOrder = [
  { project: "many", sessions: ["Newest chat", "Second chat", "Third chat"] },
  { project: "prompted", sessions: ["Last active chat", "Older prompted chat"] },
  { project: "running", sessions: ["Running chat"] },
  { project: "empty", sessions: [] },
];

async function openList(context: TestContext, width: number): Promise<Page> {
  const server = await getPreviewServer(context);
  const browser = await launchBrowser();
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height: 812 }, hasTouch: width === 375 });
  page.setDefaultTimeout(5000);
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      if (command.type === "list_sessions")
        socket.send(JSON.stringify({ type: "sessions", projects, groupsRoot: "/code" }));
    });
  });
  await page.goto(server.resolvedUrls!.local[0]);
  await page.getByText("Last active chat").waitFor();
  return page;
}

async function readOrder(page: Page) {
  return page.getByRole("main", { name: "Sessions" }).evaluate((list) =>
    Array.from(list.querySelectorAll("section[aria-label]")).map((section) => ({
      project: section.getAttribute("aria-label"),
      sessions: Array.from(section.querySelectorAll("ul.divide-y li span.block.truncate")).map(
        (title) => title.textContent,
      ),
    })),
  );
}

test(
  "desktop puts the chat with the last user message first",
  { skip: browserSkipReason, timeout: 30_000 },
  async (context) => {
    const page = await openList(context, 1280);
    assert.deepEqual(await readOrder(page), desktopOrder);
  },
);

test(
  "opens a project page for sessions beyond the first three",
  { skip: browserSkipReason, timeout: 30_000 },
  async (context) => {
    const page = await openList(context, 1280);
    const allSessions = page.getByRole("button", { name: "View all sessions" });
    await allSessions.click();
    await page.getByRole("region", { name: "many" }).getByRole("heading", { name: "many" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Oldest chat/ }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "View all sessions" }).count(), 0);
    assert.equal(await page.evaluate(() => location.hash), "#project:%2Fcode%2Fmany");

    await page.getByRole("button", { name: "All sessions" }).click();
    await allSessions.waitFor();
  },
);

test(
  "a phone opens a project page on its latest session",
  { skip: browserSkipReason, timeout: 30_000 },
  async (context) => {
    const page = await openList(context, 375);
    const project = page.getByRole("region", { name: "many" });
    await project.getByRole("button", { name: "View all sessions" }).click();
    await page.getByRole("region", { name: "many" }).getByRole("heading", { name: "many" }).waitFor();
    await page.waitForFunction(() => {
      const list = document.querySelector("main[aria-label='Sessions']");
      return !!list && list.scrollTop + list.clientHeight >= list.scrollHeight - 32;
    });
    const lastTitle = await project.locator("li button span.block.truncate").last().textContent();
    assert.equal(lastTitle, "Newest chat", "The latest session sits at the bottom of the page");
  },
);

test(
  "a phone puts the chat with the last user message last",
  { skip: browserSkipReason, timeout: 30_000 },
  async (context) => {
    const page = await openList(context, 375);
    assert.deepEqual(
      await readOrder(page),
      desktopOrder
        .slice()
        .reverse()
        .map((project) => ({
          ...project,
          sessions: project.sessions.slice().reverse(),
        })),
    );

    const list = await page.getByRole("main", { name: "Sessions" }).boundingBox();
    const lastItem = await page.getByRole("button", { name: "View all sessions" }).boundingBox();
    assert.ok(list && lastItem);
    assert.ok(
      list.y + list.height - (lastItem.y + lastItem.height) < 32,
      "The last project item sits at the bottom of the list",
    );
  },
);
