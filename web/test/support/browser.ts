import type { TestContext } from "node:test";
import { chromium, type Browser, type LaunchOptions } from "playwright";
import { preview, type PreviewServer } from "vite";

const MISSING_BROWSER =
  /(?:error while loading shared libraries: |Executable doesn't exist|Cannot find module )[^,"\n]*/;

const INSTALL_HINT = 'Run `sudo env "PATH=$PATH" npx playwright install-deps chromium` on this host to install it.';

const launchOptions: LaunchOptions = {
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
};

async function getSkipReason(): Promise<false | string> {
  try {
    const browser = await chromium.launch(launchOptions);
    await browser.close();
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = message.match(MISSING_BROWSER)?.[0];
    if (!reason) throw error;
    return `Chromium cannot start: ${reason}. ${INSTALL_HINT}`;
  }
}

/** False when a browser works here, otherwise the reason to skip a browser check. */
export const browserSkipReason: false | string = await getSkipReason();

export function launchBrowser(): Promise<Browser> {
  return chromium.launch(launchOptions);
}

export async function getPreviewServer(context: TestContext): Promise<PreviewServer> {
  const server = await preview({ server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1", port: 0 } });
  context.after(() => {
    if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
    return new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  });
  return server;
}
