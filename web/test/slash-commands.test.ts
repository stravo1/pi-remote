import assert from "node:assert/strict";
import { test } from "node:test";
import { getCommandMatches, ownCommands } from "../src/slash-commands.ts";

const commands = [...ownCommands, { name: "review" }, { name: "skill:notes" }, { name: "rename-files" }];
const names = (text: string) => getCommandMatches(text, commands).map((command) => command.name);

test("matches commands while the first word is typed, prefix matches first", () => {
  assert.deepEqual(names("/"), ["name", "compact", "session", "review", "skill:notes", "rename-files"]);
  assert.deepEqual(names("/re"), ["review", "rename-files"]);
  assert.deepEqual(names("/na"), ["name", "rename-files"]);
  assert.deepEqual(names("/skill:"), ["skill:notes"]);
  assert.deepEqual(names("/name Fix"), []);
  assert.deepEqual(names("hello /na"), []);
});
