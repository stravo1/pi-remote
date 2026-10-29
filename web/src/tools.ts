export type ToolStatus = "pending" | "running" | "success" | "error" | "interrupted";

/** One call a tool made while it ran, recorded on its result. MCP calls from a codemode script get here. */
export interface NestedToolCall {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  status: ToolStatus;
  output?: string;
  durationMs?: number;
  error?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: ToolStatus;
  output: string;
  diff?: string;
  nested?: NestedToolCall[];
}

export function getToolOutput(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content;
  return (
    content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}

export function getToolDiff(result: unknown): string | undefined {
  const diff = (result as { details?: { diff?: unknown } } | undefined)?.details?.diff;
  return typeof diff === "string" ? diff : undefined;
}

// Keys worth showing first for MCP tools, tried in order; numbers read as "key: value".
const SUMMARY_KEYS = ["query", "url", "uri", "id", "title", "name", "email", "repo", "limit", "count"];
const SUMMARY_LIMIT = 80;
// pi's terminal previews ten lines of a script; a phone row shows two.
const CODEMODE_PREVIEW_LINES = 2;

/** The one-line row text next to the tool name. */
export function getToolCommand(tool: ToolCall): string {
  const { command, path } = tool.arguments;
  if (tool.name === "bash") return typeof command === "string" ? command : JSON.stringify(tool.arguments);
  if (typeof path === "string") return path;
  if (tool.name === "codemode") return codemodePreview(tool);
  if (tool.name === "tool_search") return summarizeSearch(tool);
  return summarizeArguments(tool);
}

/** The full text behind a row, for the expanded output. A codemode row only previews its script. */
export function getToolSource(tool: ToolCall): string {
  const { code } = tool.arguments;
  return tool.name === "codemode" && typeof code === "string" ? code : getToolCommand(tool);
}

function codemodePreview(tool: ToolCall): string {
  const { code } = tool.arguments;
  if (typeof code !== "string") return JSON.stringify(tool.arguments);
  const lines = code
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "JavaScript";
  return truncate(lines.slice(0, CODEMODE_PREVIEW_LINES).join(" "), SUMMARY_LIMIT);
}

function summarizeSearch(tool: ToolCall): string {
  const { query } = tool.arguments;
  return typeof query === "string" && query.trim()
    ? `Search tools: ${truncate(query.trim(), SUMMARY_LIMIT)}`
    : "Search tools";
}

/** First useful argument value, else the JSON. MCP tools hit this most. */
function summarizeArguments(tool: ToolCall): string {
  for (const key of SUMMARY_KEYS) {
    const value = tool.arguments[key];
    if (typeof value === "string" && value.trim()) return truncate(value, SUMMARY_LIMIT);
    if (typeof value === "number") return `${key}: ${value}`;
  }
  return JSON.stringify(tool.arguments);
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/** Splits `mcp__server__tool`, the name pi gives MCP tools, into the server and the tool. */
export function splitToolName(name: string): { server?: string; tool: string } {
  if (!name.startsWith("mcp__")) return { tool: name };
  const rest = name.slice("mcp__".length);
  const index = rest.indexOf("__");
  if (index === -1) return { tool: rest };
  return { server: rest.slice(0, index), tool: rest.slice(index + 2) };
}

export function getRequestedDiff(tool: ToolCall): string {
  const { oldText, newText, content } = tool.arguments;
  if (tool.name === "write" && typeof content === "string") return prefixLines(content, "+");
  if (tool.name !== "edit" || typeof oldText !== "string" || typeof newText !== "string") return "";
  return `${prefixLines(oldText, "-")}\n${prefixLines(newText, "+")}`;
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function getDiffKind(line: string): "added" | "removed" | "context" {
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}
