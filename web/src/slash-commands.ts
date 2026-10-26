import type { CommandChoice } from "../../server/src/pi-adapter.ts";

// pi remote runs these itself. pi runs every other command.
export const ownCommands: CommandChoice[] = [
  { name: "name", description: "Rename this session", argumentHint: "<title>" },
  { name: "compact", description: "Summarize older messages to use fewer tokens", argumentHint: "[instructions]" },
  { name: "session", description: "Show tokens, cost, and context use" },
];

const maxMatches = 8;

// Matches show only while the first word is typed. Names that start with the query come first.
export function getCommandMatches(text: string, commands: CommandChoice[]): CommandChoice[] {
  const query = /^\/(\S*)$/.exec(text)?.[1].toLowerCase();
  if (query === undefined) return [];
  const starts = commands.filter((command) => command.name.toLowerCase().startsWith(query));
  const contains = commands.filter(
    (command) => !starts.includes(command) && command.name.toLowerCase().includes(query),
  );
  return [...starts, ...contains].slice(0, maxMatches);
}
