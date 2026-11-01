import { chromium, type Browser, type LaunchOptions } from "playwright";

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
