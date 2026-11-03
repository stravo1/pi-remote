import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { expandSkillCommands, type SkillFile } from "../../src/skill-commands.ts";

let directory: string;
let demo: SkillFile;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "pi-remote-skill-"));
  const filePath = join(directory, "SKILL.md");
  await writeFile(filePath, "---\nname: demo\ndescription: A test skill\n---\n\nThe demo body.\n");
  demo = { name: "demo", filePath, baseDir: directory };
});

after(() => rm(directory, { recursive: true, force: true }));

function block(): string {
  return `<skill name="demo" location="${demo.filePath}">\nReferences are relative to ${demo.baseDir}.\n\nThe demo body.\n</skill>`;
}

test("expands a bare or full skill command wherever it stands", () => {
  assert.equal(expandSkillCommands("/demo", [demo]), block());
  assert.equal(expandSkillCommands("/skill:demo do it", [demo]), `${block()} do it`);
  assert.equal(
    expandSkillCommands("ask /demo one and /skill:demo two now", [demo]),
    `ask ${block()} one and ${block()} two now`,
  );
  assert.equal(expandSkillCommands("see (/demo), then /demo.", [demo]), `see (${block()}), then ${block()}.`);
});

test("leaves other text alone", () => {
  for (const text of ["plain text", "/unknown", "see https://example.com/demo", "/demos", "/demo's turn"]) {
    assert.equal(expandSkillCommands(text, [demo]), text);
  }
});
