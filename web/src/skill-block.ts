export interface SkillBlock {
  name: string;
  location: string;
  content: string;
  /** The words the user typed after the command. */
  userMessage?: string;
}

/**
 * pi replaces a `/skill:name` prompt with a `<skill>` block before it stores the message.
 * The block holds the skill file, which is too long for the transcript, so it renders apart.
 */
export function parseSkillBlock(text: string): SkillBlock | undefined {
  const match = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/.exec(text);
  if (!match) return undefined;
  return {
    name: match[1],
    location: match[2],
    content: match[3],
    userMessage: match[4]?.trim() || undefined,
  };
}

/** One line for a place that shows prompt text, such as the message queue. */
export function describePrompt(text: string): string {
  const skill = parseSkillBlock(text);
  if (!skill) return text;
  return skill.userMessage ? `Skill ${skill.name}: ${skill.userMessage}` : `Skill ${skill.name}`;
}
