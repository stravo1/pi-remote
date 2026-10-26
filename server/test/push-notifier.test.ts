import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { WebPushError } from "web-push";
import { PushNotifier } from "../src/push-notifier.ts";

const subscription = (name: string) => ({
  endpoint: `https://push.example.com/${name}`,
  keys: { p256dh: `key-${name}`, auth: `auth-${name}` },
});

async function setup(context: TestContext, send: (endpoint: string) => Promise<void> = async () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "pi-remote-push-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state", "push.json");
  const sent: { endpoint: string; payload: string; subject: string }[] = [];
  const settings = { contact: "mailto:me@example.com", file };
  const load = () =>
    PushNotifier.load(settings, (async (target: { endpoint: string }, payload: string, options: any) => {
      sent.push({ endpoint: target.endpoint, payload, subject: options.vapidDetails.subject });
      await send(target.endpoint);
    }) as never);
  return { file, sent, load };
}

test("creates keys once, keeps subscriptions across a restart, and saves them privately", async (context) => {
  const { file, load } = await setup(context);
  const first = await load();
  await first.subscribe(subscription("phone"));
  await first.subscribe(subscription("phone"));
  const second = await load();
  assert.equal(second.publicKey, first.publicKey);
  assert.deepEqual(second.subscriptions, [subscription("phone")]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await second.unsubscribe(subscription("phone").endpoint);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).subscriptions, []);
});

test("sends the notice to every device and drops expired subscriptions", async (context) => {
  const { sent, load } = await setup(context, async (endpoint) => {
    if (endpoint.endsWith("/old")) throw new WebPushError("Gone", 410, {}, "", endpoint);
  });
  const notifier = await load();
  await notifier.subscribe(subscription("phone"));
  await notifier.subscribe(subscription("old"));
  await notifier.notify({ sessionId: "one", title: "Task", body: "Done." });
  assert.equal(sent.length, 2);
  assert.deepEqual(JSON.parse(sent[0].payload), { sessionId: "one", title: "Task", body: "Done." });
  assert.equal(sent[0].subject, "mailto:me@example.com");
  assert.deepEqual(
    notifier.subscriptions.map((item) => item.endpoint),
    [subscription("phone").endpoint],
  );
});

test("rejects invalid subscriptions and a corrupt push file", async (context) => {
  const { file, load } = await setup(context);
  const notifier = await load();
  for (const value of [undefined, { endpoint: "http://push.example.com/a", keys: {} }, { endpoint: "https://a" }]) {
    await assert.rejects(notifier.subscribe(value), /invalid/);
  }
  await writeFile(file, "{}");
  await assert.rejects(load(), /corrupt/);
});
