export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "pending" | "running" | "success" | "error" | "interrupted";
  output: string;
  diff?: string;
}

export function getToolOutput(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content;
  return content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n") ?? "";
}

export function getToolDiff(result: unknown): string | undefined {
  const diff = (result as { details?: { diff?: unknown } } | undefined)?.details?.diff;
  return typeof diff === "string" ? diff : undefined;
}

export function getToolCommand(tool: ToolCall): string {
  const argument = tool.name === "bash" ? tool.arguments.command : tool.arguments.path;
  return typeof argument === "string" ? argument : JSON.stringify(tool.arguments);
}

export function getRequestedDiff(tool: ToolCall): string {
  const { oldText, newText, content } = tool.arguments;
  if (tool.name === "write" && typeof content === "string") return prefixLines(content, "+");
  if (tool.name !== "edit" || typeof oldText !== "string" || typeof newText !== "string") return "";
  return `${prefixLines(oldText, "-")}\n${prefixLines(newText, "+")}`;
}

function prefixLines(text: string, prefix: string): string {
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

export function getDiffKind(line: string): "added" | "removed" | "context" {
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}
