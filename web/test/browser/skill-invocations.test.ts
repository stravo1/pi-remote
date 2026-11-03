import assert from "node:assert/strict";
import { test } from "node:test";
import { browserSkipReason, getPreviewServer, launchBrowser } from "../support/browser.ts";

const skillText =
  '<skill name="demo" location="/skills/demo/SKILL.md">\nReferences are relative to /skills/demo.\n\nThe secret instructions.\n</skill>';

test(
  "shows a skill invocation as one row and hides the skill text until tapped",
  { skip: browserSkipReason, timeout: 30_000 },
  async (context) => {
    const server = await getPreviewServer(context);
    const browser = await launchBrowser();
    context.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
    page.setDefaultTimeout(5000);
    await page.routeWebSocket("**/ws", (route) => {
      route.onMessage((raw) => {
        const command = JSON.parse(String(raw));
        if (command.type === "list_sessions")
          route.send(
            JSON.stringify({
              type: "sessions",
              projects: [{ path: "/p", sessions: [{ id: "one", firstMessage: "Hi", modified: 1, isRunning: false }] }],
            }),
          );
        if (command.type !== "subscribe") return;
        route.send(
          JSON.stringify({
            type: "snapshot",
            sessionId: "one",
            seq: 0,
            messages: [
              { role: "user", timestamp: 1, content: [{ type: "text", text: `${skillText}\n\nrun the demo` }] },
              { role: "assistant", timestamp: 2, content: [{ type: "text", text: "Done." }] },
            ],
            runEvents: [],
            isStreaming: false,
            isCompacting: false,
            queue: { steering: [], followUp: [] },
          }),
        );
      });
    });
    const address = server.httpServer.address();
    assert.ok(address && typeof address === "object");
    await page.goto(`http://127.0.0.1:${address.port}/#one`);

    const row = page.getByText("Skill", { exact: true });
    await row.waitFor();
    await page.getByText("demo", { exact: true }).waitFor();
    await page.getByText("run the demo").waitFor();
    assert.equal(await page.getByText("The secret instructions.").isVisible(), false);
    assert.equal(await page.getByText(/References are relative/).isVisible(), false);

    await row.click();
    await page.getByText("The secret instructions.").waitFor();
  },
);
