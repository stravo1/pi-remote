import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { SettingsStore } from "../../src/settings-store.ts";

async function setup(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pi-remote-settings-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("keeps every session until a retention period is saved", async (context) => {
  const root = await setup(context);
  assert.equal(await new SettingsStore(root).get_retention(), null);
});

test("saves the retention period and keeps it after a restart", async (context) => {
  const root = await setup(context);
  await new SettingsStore(root).set_retention(7);
  assert.equal(await new SettingsStore(root).get_retention(), 7);
  assert.deepEqual(JSON.parse(await readFile(join(root, ".pi-remote", "settings.json"), "utf8")), {
    retentionDays: 7,
  });
  await new SettingsStore(root).set_retention(null);
  assert.equal(await new SettingsStore(root).get_retention(), null);
});

test("rejects a retention period that is not a whole number of days", async (context) => {
  const store = new SettingsStore(await setup(context));
  for (const value of [0, -1, 1.5, "7", undefined, true])
    await assert.rejects(store.set_retention(value), /whole number of days/);
});

test("fails loudly on a corrupt settings file", async (context) => {
  const root = await setup(context);
  await mkdir(join(root, ".pi-remote"), { recursive: true });
  await writeFile(join(root, ".pi-remote", "settings.json"), "{");
  await assert.rejects(new SettingsStore(root).get_retention(), SyntaxError);
  await writeFile(join(root, ".pi-remote", "settings.json"), JSON.stringify({ retentionDays: "week" }));
  await assert.rejects(new SettingsStore(root).get_retention(), /whole number of days/);
});
