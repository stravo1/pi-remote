import assert from "node:assert/strict";
import { test } from "node:test";
import { preview } from "vite";
import { chromium, type Page } from "playwright";

async function choose(page: Page, method: string): Promise<void> {
  await page.getByRole("button", { name: "Add provider" }).click();
  await page.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: "OpenAI" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: method }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

test("settings save keys and show OAuth device codes", { timeout: 30_000 }, async (context) => {
  const server = await preview({ server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1", port: 0 } });
  context.after(() => {
    if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
    return new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
  page.setDefaultTimeout(5000);
  const commands: any[] = [];
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      commands.push(command);
      if (command.type === "list_sessions") socket.send(JSON.stringify({ type: "sessions", projects: [] }));
      if (command.type === "list_providers" || command.type === "set_provider_key") {
        socket.send(JSON.stringify({ type: "providers", providers: [{
          id: "openai", name: "OpenAI", authTypes: ["api_key", "oauth"], accountLabel: "Sign in with ChatGPT", isConfigured: command.type === "set_provider_key", isUsingApiKey: command.type === "set_provider_key",
        }, { id: "groq", name: "Groq", authTypes: ["api_key"], isConfigured: false, isUsingApiKey: false }] }));
      }
      if (command.type === "start_provider_login" && command.authType === "api_key") {
        socket.send(JSON.stringify({ type: "provider_login_started", loginId: "login-two" }));
        socket.send(JSON.stringify({ type: "provider_login_event", loginId: "login-two", event: { type: "failed", message: "Setup failed." } }));
      } else if (command.type === "start_provider_login") {
        socket.send(JSON.stringify({ type: "provider_login_started", loginId: "login-one" }));
        socket.send(JSON.stringify({ type: "provider_login_event", loginId: "login-one", event: {
          type: "device_code", verificationUri: "https://example.com/device", userCode: "ABCD-1234",
        } }));
        socket.send(JSON.stringify({ type: "provider_login_event", loginId: "login-one", event: {
          type: "prompt", prompt: { type: "text", message: "Paste the redirect URL" },
        } }));
      }
    });
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  await page.goto(`http://127.0.0.1:${address.port}/#settings`);
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await choose(page, "API key");
  await page.getByLabel("OpenAI API key").fill("not-a-real-key");
  await page.getByRole("button", { name: "Save key" }).click();
  for (let attempt = 0; attempt < 100 && !commands.some((command) => command.type === "set_provider_key"); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(commands.some((command) => command.type === "set_provider_key"));
  await page.getByRole("list", { name: "Connected providers" }).getByText("OpenAI", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit key" }).click();
  await page.getByLabel("OpenAI API key").fill("another-key");
  await page.getByRole("button", { name: "Save key" }).click();
  for (let attempt = 0; attempt < 100 && !commands.some((command) => command.apiKey === "another-key"); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(commands.some((command) => command.type === "set_provider_key" && command.provider === "openai" && command.apiKey === "another-key"));
  await choose(page, "Sign in with ChatGPT");
  await page.getByText("ABCD-1234", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Paste the redirect URL" }).waitFor();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("radio", { name: "API key" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Guided setup" }).click();
  await page.getByText("Setup failed.", { exact: true }).waitFor();
  assert.ok(commands.some((command) => command.type === "set_provider_key" && command.apiKey === "not-a-real-key"));
  assert.ok(commands.some((command) => command.type === "start_provider_login" && command.authType === "oauth"));
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add provider" }).click();
  const bars = page.getByRole("dialog").locator("span.h-1");
  assert.equal(await bars.count(), 3);
  await page.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: "Groq" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Groq API key").waitFor();
  assert.equal(await bars.count(), 2);
});
