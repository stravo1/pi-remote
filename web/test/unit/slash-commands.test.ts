import assert from "node:assert/strict";
import { test } from "node:test";
import { getCommandMatches, getCommandToken, ownCommands, replaceCommandToken } from "../../src/slash-commands.ts";

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

test("matches a skill by its bare name, as pi's own completion offers it", () => {
  assert.deepEqual(names("/no"), ["skill:notes"]);
  assert.deepEqual(names("/notes"), ["skill:notes"]);
  assert.deepEqual(names("/skill:n"), ["skill:notes"]);
});

test("matches a skill in the middle of a sentence, where only skills expand", () => {
  assert.deepEqual(names("ask /no"), ["skill:notes"]);
  assert.deepEqual(names("ask /skill:n"), ["skill:notes"]);
  assert.deepEqual(names("ask /re"), []);
  assert.deepEqual(names("ask /name"), []);
  assert.deepEqual(names("ask /no now"), []);
});

test("replaces only the command being typed and keeps the sentence", () => {
  assert.equal(replaceCommandToken("ask /no", { name: "skill:notes" }), "ask /skill:notes ");
  assert.equal(replaceCommandToken("/no", { name: "skill:notes" }), "/skill:notes ");
  assert.equal(replaceCommandToken("ask", { name: "skill:notes" }), "ask");
});

test("locates the command token at the end of the input", () => {
  assert.deepEqual(getCommandToken("ask /no"), { start: 4, query: "no" });
  assert.deepEqual(getCommandToken("/Skill:Notes"), { start: 0, query: "skill:notes" });
  assert.equal(getCommandToken("ask /no now"), undefined);
  assert.equal(getCommandToken("and/or"), undefined);
});
