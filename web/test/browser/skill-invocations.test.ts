import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { browserSkipReason, getPreviewServer, launchBrowser } from "../support/browser.ts";

const block = (name: string, body: string) =>
  `<skill name="${name}" location="/skills/${name}/SKILL.md">\nReferences are relative to /skills/${name}.\n\n${body}\n</skill>`;

const settings = {
  model: { provider: "faux", id: "first", name: "First" },
  models: [{ provider: "faux", id: "first", name: "First" }],
  thinkingLevel: "off",
  thinkingLevels: ["off"],
  commands: [{ name: "skill:demo", description: "A demo skill" }],
};

async function open(context: TestContext, messages: object[]) {
  const server = await getPreviewServer(context);
  const browser = await launchBrowser();
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
  page.setDefaultTimeout(5000);
  const commands: any[] = [];
  await page.routeWebSocket("**/ws", (route) => {
    route.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      commands.push(command);
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
          messages,
          runEvents: [],
          isStreaming: false,
          isCompacting: false,
          queue: { steering: [], followUp: [] },
          settings,
        }),
      );
    });
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  await page.goto(`http://127.0.0.1:${address.port}/#one`);
  return { page, commands };
}

test(
  "shows a skill invocation as one row and hides the skill text until tapped",
  { skip: browserSkipReason, timeout: 30_000 },
  async (context) => {
    const { page } = await open(context, [
      {
        role: "user",
        timestamp: 1,
        content: [
          {
            type: "text",
            text: `run ${block("alpha", "The secret instructions.")} and ${block("beta", "More secrets.")} now`,
          },
        ],
      },
      { role: "assistant", timestamp: 2, content: [{ type: "text", text: "Done." }] },
    ]);

    await page.getByText("alpha", { exact: true }).waitFor();
    await page.getByText("beta", { exact: true }).waitFor();
    assert.equal(await page.getByText("Skill", { exact: true }).count(), 2);
    for (const text of ["run", "and", "now"]) await page.getByText(text, { exact: true }).waitFor();
    assert.equal(await page.getByText("The secret instructions.").isVisible(), false);
    assert.equal(await page.getByText("More secrets.").isVisible(), false);
    assert.equal(
      await page
        .getByText(/References are relative/)
        .first()
        .isVisible(),
      false,
    );

    await page.getByText("alpha", { exact: true }).click();
    await page.getByText("The secret instructions.").waitFor();
    assert.equal(await page.getByText("More secrets.").isVisible(), false);
  },
);

test("picks a skill in the middle of a sentence", { skip: browserSkipReason, timeout: 30_000 }, async (context) => {
  const { page, commands } = await open(context, []);
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("ask /dem");
  await page.getByRole("option", { name: /\/skill:demo/ }).click();
  assert.equal(await message.inputValue(), "ask /skill:demo ");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (commands.some((command) => command.type === "prompt" && command.text === "ask /skill:demo ")) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail("The prompt did not reach the server.");
  });
});
