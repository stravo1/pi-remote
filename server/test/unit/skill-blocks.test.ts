import assert from "node:assert/strict";
import { test } from "node:test";
import { describePrompt, parsePrompt } from "../../src/skill-blocks.ts";

const block = (name: string, body = `The ${name} body.`) =>
  `<skill name="${name}" location="/skills/${name}/SKILL.md">\nReferences are relative to /skills/${name}.\n\n${body}\n</skill>`;

test("parses the skill blocks and the text around them", () => {
  assert.deepEqual(parsePrompt("hello"), [{ text: "hello" }]);

  const leading = parsePrompt(`${block("demo")}\n\nrun the demo`);
  assert.equal(leading.length, 2);
  assert.equal(leading[0].skill?.name, "demo");
  assert.equal(leading[1].text, "\n\nrun the demo");

  const inline = parsePrompt(`run ${block("one")} and ${block("two")} now`);
  assert.deepEqual(
    inline.map((segment) => segment.skill?.name ?? segment.text),
    ["run ", "one", " and ", "two", " now"],
  );
});

test("describes a prompt in one line without the skill files", () => {
  assert.equal(describePrompt("plain text"), "plain text");
  assert.equal(describePrompt(`${block("demo")}\n\nrun the demo`), "[Skill demo] run the demo");
  assert.equal(describePrompt(`run ${block("one")} and ${block("two")} now`), "run [Skill one] and [Skill two] now");
});
