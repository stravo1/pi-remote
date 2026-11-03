import type { CommandChoice } from "../../server/src/protocol.ts";

// pi remote runs these itself. pi runs every other command.
export const ownCommands: CommandChoice[] = [
  { name: "name", description: "Rename this session", argumentHint: "<title>" },
  { name: "compact", description: "Summarize older messages to use fewer tokens", argumentHint: "[instructions]" },
  { name: "session", description: "Show tokens, cost, and context use" },
];

const maxMatches = 8;
const skillPrefix = "skill:";

// A skill also answers to its bare name, as pi's own completion offers it.
function getMatchRank(command: CommandChoice, query: string): number | undefined {
  const name = command.name.toLowerCase();
  const bareName = name.startsWith(skillPrefix) ? name.slice(skillPrefix.length) : undefined;
  if (name.startsWith(query) || bareName?.startsWith(query)) return 0;
  if (name.includes(query) || bareName?.includes(query)) return 1;
  return undefined;
}

// Matches show only while the first word is typed. Names that start with the query come first.
export function getCommandMatches(text: string, commands: CommandChoice[]): CommandChoice[] {
  const query = /^\/(\S*)$/.exec(text)?.[1].toLowerCase();
  if (query === undefined) return [];
  const ranked = commands
    .map((command) => ({ command, rank: getMatchRank(command, query) }))
    .filter((entry) => entry.rank !== undefined);
  return [...ranked.filter((entry) => entry.rank === 0), ...ranked.filter((entry) => entry.rank === 1)]
    .slice(0, maxMatches)
    .map((entry) => entry.command);
}
