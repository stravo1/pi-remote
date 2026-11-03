export interface SkillBlock {
  name: string;
  location: string;
  content: string;
}

/** A prompt split into the skill blocks pi stores and the text around them. */
export interface PromptSegment {
  skill?: SkillBlock;
  text?: string;
}

// pi writes a skill file into the message as this block when the user runs /skill:name.
const blockPattern = /<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>/g;

export function parsePrompt(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let end = 0;
  for (const match of text.matchAll(blockPattern)) {
    const start = match.index ?? 0;
    if (start > end) segments.push({ text: text.slice(end, start) });
    segments.push({ skill: { name: match[1], location: match[2], content: match[3] } });
    end = start + match[0].length;
  }
  if (end < text.length) segments.push({ text: text.slice(end) });
  return segments.length ? segments : [{ text }];
}

/** One line for a session list or a queued message, with skill files left out. */
export function describePrompt(text: string): string {
  const segments = parsePrompt(text);
  if (segments.every((segment) => !segment.skill)) return text;
  return segments
    .map((segment) => (segment.skill ? `[Skill ${segment.skill.name}]` : (segment.text ?? "")))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
