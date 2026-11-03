import assert from "node:assert/strict";
import { test } from "node:test";
import { getCommandMatches, ownCommands } from "../../src/slash-commands.ts";

const commands = [...ownCommands, { name: "review" }, { name: "skill:notes" }, { name: "rename-files" }];
const names = (text: string) => getCommandMatches(text, commands).map((command) => command.name);

test("matches commands while the first word is typed, prefix matches first", () => {
  assert.deepEqual(names("/"), ["name", "compact", "session", "review", "skill:notes", "rename-files"]);
  assert.deepEqual(names("/re"), ["review", "rename-files"]);
  assert.deepEqual(names("/na"), ["name", "rename-files"]);
  assert.deepEqual(names("/skill:"), ["skill:notes"]);
  assert.deepEqual(names("/name Fix"), []);
});

test("matches a skill by its bare name, as pi's own completion offers it", () => {
  assert.deepEqual(names("/no"), ["skill:notes"]);
  assert.deepEqual(names("/notes"), ["skill:notes"]);
  assert.deepEqual(names("/skill:n"), ["skill:notes"]);
});

test("keeps the list closed once the message continues past the first word", () => {
  assert.deepEqual(names("ask /no"), []);
  assert.deepEqual(names("/no now"), []);
  assert.deepEqual(names("hello /na"), []);
});
