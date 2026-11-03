import assert from "node:assert/strict";
import { test } from "node:test";
import { type Page } from "playwright";
import { browserSkipReason, getPreviewServer, launchBrowser } from "../support/browser.ts";

async function choose(page: Page, method: string): Promise<void> {
  await page.getByRole("button", { name: "Add provider" }).click();
  await page.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: "OpenAI" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: method }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

test(
  "settings save keys and show OAuth device codes",
  { skip: browserSkipReason, timeout: 30_000 },
  async (context) => {
    const server = await getPreviewServer(context);
    const browser = await launchBrowser();
    context.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
    page.setDefaultTimeout(5000);
    const commands: any[] = [];
    let isKeySaved = false;
    await page.routeWebSocket("**/ws", (socket) => {
      socket.onMessage((raw) => {
        const command = JSON.parse(String(raw));
        commands.push(command);
        if (command.type === "list_sessions") socket.send(JSON.stringify({ type: "sessions", projects: [] }));
        if (command.type === "submit_provider_login" && command.loginId === "login-two") {
          isKeySaved = true;
          socket.send(
            JSON.stringify({ type: "provider_login_event", loginId: "login-two", event: { type: "complete" } }),
          );
        }
        if (command.type === "logout_provider") isKeySaved = false;
        if (["list_providers", "set_provider_key", "logout_provider"].includes(command.type)) {
          socket.send(
            JSON.stringify({
              type: "providers",
              providers: [
                {
                  id: "openai",
                  name: "OpenAI",
                  authTypes: ["api_key", "oauth"],
                  accountLabel: "Sign in with ChatGPT",
                  isConfigured: isKeySaved,
                  isUsingApiKey: isKeySaved,
                  hasStoredLogin: isKeySaved,
                },
                {
                  id: "groq",
                  name: "Groq",
                  authTypes: ["api_key"],
                  isConfigured: false,
                  isUsingApiKey: false,
                  hasStoredLogin: false,
                },
              ],
            }),
          );
        }
        if (command.type === "get_provider_key")
          socket.send(JSON.stringify({ type: "provider_key", provider: command.provider, apiKey: "not-a-real-key" }));
        if (command.type === "get_default_model" || command.type === "set_default_model") {
          const model =
            command.type === "set_default_model" && command.provider
              ? { provider: command.provider, id: command.modelId, name: "GPT-5" }
              : undefined;
          socket.send(
            JSON.stringify({
              type: "default_model",
              models: [{ provider: "openai", id: "gpt-5", name: "GPT-5" }],
              ...(model ? { model } : {}),
            }),
          );
        }
        if (command.type === "start_provider_login" && command.provider === "groq") {
          socket.send(JSON.stringify({ type: "provider_login_started", loginId: "login-three" }));
          socket.send(
            JSON.stringify({
              type: "provider_login_event",
              loginId: "login-three",
              event: { type: "failed", message: "Setup failed." },
            }),
          );
        } else if (command.type === "start_provider_login" && command.authType === "api_key") {
          socket.send(JSON.stringify({ type: "provider_login_started", loginId: "login-two" }));
          socket.send(
            JSON.stringify({
              type: "provider_login_event",
              loginId: "login-two",
              event: { type: "prompt", prompt: { type: "secret", message: "Enter OpenAI API key" } },
            }),
          );
        } else if (command.type === "start_provider_login") {
          socket.send(JSON.stringify({ type: "provider_login_started", loginId: "login-one" }));
          socket.send(
            JSON.stringify({
              type: "provider_login_event",
              loginId: "login-one",
              event: {
                type: "device_code",
                verificationUri: "https://example.com/device",
                userCode: "ABCD-1234",
              },
            }),
          );
          socket.send(
            JSON.stringify({
              type: "provider_login_event",
              loginId: "login-one",
              event: {
                type: "prompt",
                prompt: { type: "text", message: "Paste the redirect URL" },
              },
            }),
          );
        }
      });
    });
    const address = server.httpServer.address();
    assert.ok(address && typeof address === "object");
    await page.goto(`http://127.0.0.1:${address.port}/#settings`);
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await choose(page, "API key");
    await page.getByLabel("Enter OpenAI API key").fill("not-a-real-key");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("list", { name: "Connected providers" }).getByText("OpenAI", { exact: true }).waitFor();
    assert.ok(
      commands.some((command) => command.type === "submit_provider_login" && command.value === "not-a-real-key"),
    );
    await page.getByRole("list", { name: "Connected providers" }).getByText("OpenAI", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit key" }).click();
    await page.waitForFunction(
      () => document.querySelector<HTMLInputElement>("input[aria-label='OpenAI API key']")?.value === "not-a-real-key",
    );
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "OpenAI API key");
    await page.getByRole("button", { name: "Show password" }).click();
    assert.equal(await page.getByLabel("OpenAI API key").getAttribute("type"), "text");
    await page.getByLabel("OpenAI API key").fill("another-key");
    await page.getByRole("button", { name: "Save key" }).click();
    for (let attempt = 0; attempt < 100 && !commands.some((command) => command.apiKey === "another-key"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(
      commands.some(
        (command) =>
          command.type === "set_provider_key" && command.provider === "openai" && command.apiKey === "another-key",
      ),
    );
    const providerList = page.getByRole("list", { name: "Connected providers" });
    await providerList.getByText("openai", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    assert.ok(!commands.some((command) => command.type === "logout_provider"), "One tap does not sign out");
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor({ timeout: 4000 });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Confirm sign out of OpenAI" }).click();
    await page.getByText("No providers connected").waitFor();
    await page.getByText("No providers connected").waitFor();
    await page.getByRole("button", { name: /New sessions/ }).click();
    await page.getByRole("option", { name: /GPT-5/ }).click();
    assert.ok(
      commands.some(
        (command) =>
          command.type === "set_default_model" && command.provider === "openai" && command.modelId === "gpt-5",
      ),
    );
    assert.ok(commands.some((command) => command.type === "logout_provider" && command.provider === "openai"));
    await choose(page, "Sign in with ChatGPT");
    await page.getByText("ABCD-1234", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Paste the redirect URL" }).waitFor();
    assert.ok(commands.some((command) => command.type === "start_provider_login" && command.authType === "oauth"));
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Add provider" }).click();
    const bars = page.getByRole("dialog").locator("span.h-1");
    assert.equal(await bars.count(), 3);
    await page.getByRole("combobox", { name: "Provider" }).click();
    await page.getByRole("option", { name: "Groq" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    assert.equal(await bars.count(), 2);
    await page.getByText("Setup failed.", { exact: true }).waitFor();
    await page.getByRole("combobox", { name: "Provider" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const getTheme = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    const getThemeColor = () =>
      page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute("content"));
    const getColorScheme = () =>
      page.evaluate(() => document.querySelector('meta[name="color-scheme"]')?.getAttribute("content"));
    const getIconHref = () => page.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute("href"));
    assert.equal(await getTheme(), "light");
    assert.equal(await getThemeColor(), "#ffffff");
    assert.equal(await getColorScheme(), "light");
    assert.equal(await getIconHref(), "/favicon-light.svg");
    await page.getByRole("combobox", { name: "Theme" }).click();
    await page.getByRole("option", { name: "Dark" }).click();
    assert.equal(await getTheme(), "dark");
    assert.equal(await page.evaluate(() => localStorage.getItem("theme")), "dark");
    // The status bar is painted from theme-color, so it must follow the scheme.
    await page.waitForFunction(
      () =>
        document.querySelector('meta[name="theme-color"]')?.getAttribute("content") === "#171717" &&
        document.querySelector('meta[name="color-scheme"]')?.getAttribute("content") === "dark" &&
        document.querySelector('link[rel="icon"]')?.getAttribute("href") === "/favicon-dark.svg",
    );
    // The inline script in index.html applies the saved scheme before the app loads.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as any).themeBeforeApp = document.documentElement.getAttribute("data-theme");
        (window as any).iconBeforeApp = document.querySelector('link[rel="icon"]')?.getAttribute("href");
      });
    });
    await page.reload();
    assert.equal(await page.evaluate(() => (window as any).themeBeforeApp), "dark");
    assert.equal(await page.evaluate(() => (window as any).iconBeforeApp), "/favicon-dark.svg");
    assert.equal(await getThemeColor(), "#171717");
    assert.equal(await getColorScheme(), "dark");
    assert.equal(await getIconHref(), "/favicon-dark.svg");
    const systemDark = await browser.newPage({ colorScheme: "dark" });
    await systemDark.goto(page.url());
    assert.equal(await systemDark.evaluate(() => document.documentElement.getAttribute("data-theme")), "dark");
    assert.equal(
      await systemDark.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute("content")),
      "#171717",
    );
    assert.equal(
      await systemDark.evaluate(() => document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")),
      "dark",
    );
    assert.equal(
      await systemDark.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute("href")),
      "/favicon-dark.svg",
    );
    // A dark device must not force a dark icon onto a light tab bar.
    const darkDeviceLightApp = await browser.newPage({ colorScheme: "dark" });
    await darkDeviceLightApp.addInitScript(() => localStorage.setItem("theme", "light"));
    await darkDeviceLightApp.goto(page.url());
    assert.equal(await darkDeviceLightApp.evaluate(() => document.documentElement.getAttribute("data-theme")), "light");
    assert.equal(
      await darkDeviceLightApp.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute("href")),
      "/favicon-light.svg",
    );
    await darkDeviceLightApp.close();
    await systemDark.close();
  },
);
