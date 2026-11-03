import assert from "node:assert/strict";
import { test } from "node:test";
import { describePrompt, parseSkillBlock } from "../../src/skill-block.ts";

const text =
  '<skill name="demo" location="/skills/demo/SKILL.md">\nReferences are relative to /skills/demo.\n\nThe body.\n</skill>';

test("parses a skill block with and without a user message", () => {
  const plain = parseSkillBlock(text);
  assert.equal(plain?.name, "demo");
  assert.equal(plain?.location, "/skills/demo/SKILL.md");
  assert.match(plain?.content ?? "", /The body\./);
  assert.equal(plain?.userMessage, undefined);

  const withMessage = parseSkillBlock(`${text}\n\n run the demo `);
  assert.equal(withMessage?.userMessage, "run the demo");
});

test("describes a skill prompt in one line for the queue", () => {
  assert.equal(describePrompt(`${text}\n\nrun the demo`), "Skill demo: run the demo");
  assert.equal(describePrompt(text), "Skill demo");
  assert.equal(describePrompt("plain text"), "plain text");
});

test("leaves ordinary text alone", () => {
  assert.equal(parseSkillBlock("hello"), undefined);
  assert.equal(parseSkillBlock(`prefix ${text}`), undefined);
  assert.equal(parseSkillBlock(`<skill name="demo" location="/s">short</skill>`), undefined);
});
