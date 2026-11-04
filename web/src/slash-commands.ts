import type { CommandChoice } from "../../server/src/protocol.ts";

// pi remote runs these itself. pi runs every other command.
export const ownCommands: CommandChoice[] = [
  { name: "name", description: "Rename this session", argumentHint: "<title>" },
  { name: "compact", description: "Summarize older messages to use fewer tokens", argumentHint: "[instructions]" },
  { name: "session", description: "Show tokens, cost, and context use" },
];

const maxMatches = 8;
const skillPrefix = "skill:";

export interface CommandToken {
  /** Where the slash sits in the text. */
  start: number;
  query: string;
}

// A command starts the input or follows whitespace, so it can sit in the middle of a sentence.
const tokenPattern = /(^|\s)\/(\S*)$/;

export function getCommandToken(text: string): CommandToken | undefined {
  const match = tokenPattern.exec(text);
  if (!match) return undefined;
  return { start: match.index + match[1].length, query: match[2].toLowerCase() };
}

// A skill also answers to its bare name, as pi's own completion offers it.
function getMatchRank(command: CommandChoice, query: string): number | undefined {
  const name = command.name.toLowerCase();
  const bareName = name.startsWith(skillPrefix) ? name.slice(skillPrefix.length) : undefined;
  if (name.startsWith(query) || bareName?.startsWith(query)) return 0;
  if (name.includes(query) || bareName?.includes(query)) return 1;
  return undefined;
}

/**
 * Matches show while the command being typed is the last word. Names that start with the query
 * come first. Mid-sentence only a skill expands, so other commands wait for the start.
 */
export function getCommandMatches(text: string, commands: CommandChoice[]): CommandChoice[] {
  const token = getCommandToken(text);
  if (!token) return [];
  const choices = token.start === 0 ? commands : commands.filter((command) => command.name.startsWith(skillPrefix));
  const ranked = choices
    .map((command) => ({ command, rank: getMatchRank(command, token.query) }))
    .filter((entry) => entry.rank !== undefined);
  return [...ranked.filter((entry) => entry.rank === 0), ...ranked.filter((entry) => entry.rank === 1)]
    .slice(0, maxMatches)
    .map((entry) => entry.command);
}

/** Replaces the command being typed and leaves the rest of the sentence alone. */
export function replaceCommandToken(text: string, command: CommandChoice): string {
  const token = getCommandToken(text);
  if (!token) return text;
  return `${text.slice(0, token.start)}/${command.name} `;
}
