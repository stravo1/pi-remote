import { readFileSync } from "node:fs";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";

export interface SkillFile {
  name: string;
  filePath: string;
  baseDir: string;
}

// A command stands at the start or after whitespace, and may be followed by punctuation.
const commandPattern = /(^|[\s(])\/([^\s,.;!?)]+)([.,;!?)]*)/g;

/**
 * pi expands only a leading `/skill:name`. A skill also answers to its bare name, and a prompt
 * can invoke more than one skill in the middle of a sentence, so pi remote expands every one.
 */
export function expandSkillCommands(text: string, skills: SkillFile[]): string {
  const files = new Map<string, SkillFile>();
  for (const skill of skills) {
    files.set(skill.name, skill);
    files.set(`skill:${skill.name}`, skill);
  }
  const blocks = new Map<SkillFile, string>();
  return text.replace(commandPattern, (match, prefix: string, name: string, punctuation: string) => {
    const skill = files.get(name);
    if (!skill) return match;
    let block = blocks.get(skill);
    if (block === undefined) {
      block = toSkillBlock(skill);
      blocks.set(skill, block);
    }
    return `${prefix}${block}${punctuation}`;
  });
}

function toSkillBlock(skill: SkillFile): string {
  const body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}
