import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionActivity } from "../src/session-activity.ts";

const header = JSON.stringify({
  type: "session",
  version: 3,
  id: "s",
  timestamp: new Date(0).toISOString(),
  cwd: "/p",
});
const entry = (role: string, timestamp: number) =>
  JSON.stringify({
    type: "message",
    id: `${role}-${timestamp}`,
    parentId: null,
    timestamp: new Date(timestamp).toISOString(),
    message: { role, content: "Text", timestamp },
  });

test("finds the last user message and follows appended lines", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-remote-activity-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "s.jsonl");
  await writeFile(path, [header, entry("user", 1000), entry("assistant", 2000)].join("\n") + "\n");
  const activity = new SessionActivity();
  assert.deepEqual(
    await Promise.all([activity.lastUserMessage(path), activity.lastUserMessage(path)]),
    [1000, 1000],
    "Two list requests for one file read it once and agree",
  );

  // A reply from the assistant does not move the user's last message.
  await appendFile(path, entry("assistant", 3000) + "\n");
  assert.equal(await activity.lastUserMessage(path), 1000);

  await appendFile(path, entry("user", 4000) + "\n");
  assert.equal(await activity.lastUserMessage(path), 4000);

  // A line cut in the middle of a write waits for its newline.
  const partial = entry("user", 5000);
  await appendFile(path, partial.slice(0, 20));
  assert.equal(await activity.lastUserMessage(path), 4000);
  await appendFile(path, partial.slice(20) + "\n");
  assert.equal(await activity.lastUserMessage(path), 5000);

  // A rewritten file starts again from the beginning.
  await writeFile(path, [header, entry("user", 6000)].join("\n") + "\n");
  assert.equal(await activity.lastUserMessage(path), 6000);
});
