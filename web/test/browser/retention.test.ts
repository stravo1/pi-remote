import assert from "node:assert/strict";
import { test } from "node:test";
import { browserSkipReason, getPreviewServer, launchBrowser } from "../support/browser.ts";

test("settings save a custom retention period", { skip: browserSkipReason, timeout: 30_000 }, async (context) => {
  const server = await getPreviewServer(context);
  const browser = await launchBrowser();
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
  page.setDefaultTimeout(5000);
  const commands: any[] = [];
  let retentionDays: number | null = null;
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      commands.push(command);
      const reply = (message: object) => socket.send(JSON.stringify(message));
      if (command.type === "list_sessions") reply({ type: "sessions", projects: [] });
      if (command.type === "get_settings") reply({ type: "settings", retentionDays });
      if (command.type === "set_retention") {
        retentionDays = command.retentionDays;
        reply({ type: "settings", retentionDays });
      }
    });
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  await page.goto(`http://127.0.0.1:${address.port}/#settings`);
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  const select = page.getByRole("combobox", { name: "Auto delete sessions" });
  await select.getByText("Never").waitFor();
  await select.click();
  await page.getByRole("option", { name: "Custom" }).click();
  await page.getByLabel("Days to keep a session").fill("14");
  await page.getByRole("button", { name: "Save days" }).click();
  for (let attempt = 0; attempt < 100 && !commands.some((command) => command.type === "set_retention"); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(commands.some((command) => command.type === "set_retention" && command.retentionDays === 14));
  await select.getByText("Custom").waitFor();
  await page.getByLabel("Days to keep a session").waitFor();
  assert.equal(await page.getByLabel("Days to keep a session").inputValue(), "14");
  await select.click();
  await page.getByRole("option", { name: "Never" }).click();
  for (let attempt = 0; attempt < 100 && retentionDays !== null; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(commands.some((command) => command.type === "set_retention" && command.retentionDays === null));
  await page.getByLabel("Days to keep a session").waitFor({ state: "detached" });
  await select.getByText("Never").waitFor();
});
