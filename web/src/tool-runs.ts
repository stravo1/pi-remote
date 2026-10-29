import type { ToolCall } from "./tools.ts";
import type { TranscriptMessage } from "./transcript.ts";

// A short run stays as single cards. Group only when many commands run back to back.
export const MINIMUM_GROUP_SIZE = 3;

export interface MessageItem {
  type: "message";
  index: number;
}

export interface ToolRunItem {
  type: "tools";
  /** Indexes of the transcript messages in the run, in order. */
  indexes: number[];
  /** Tool call ids in the run, in order. */
  toolCallIds: string[];
}

export type TranscriptItem = MessageItem | ToolRunItem;

/**
 * Folds runs of tool call messages into one item, so the transcript can show "Ran N commands".
 * Thinking blocks belong to the tool call message that holds them. Empty messages while a reply
 * streams and tool results that render inside their card do not break a run.
 */
export function getTranscriptItems(
  messages: TranscriptMessage[],
  tools: Record<string, ToolCall>,
  offset = 0,
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let run: ToolRunItem | undefined;
  const flush = () => {
    if (!run) return;
    if (run.toolCallIds.length >= MINIMUM_GROUP_SIZE) items.push(run);
    else items.push(...run.indexes.map((index): MessageItem => ({ type: "message", index })));
    run = undefined;
  };
  messages.forEach((message, position) => {
    if (isHidden(message, tools)) return;
    const toolCallIds = getToolStep(message, tools);
    if (toolCallIds) {
      run ??= { type: "tools", indexes: [], toolCallIds: [] };
      run.indexes.push(offset + position);
      run.toolCallIds.push(...toolCallIds);
      return;
    }
    flush();
    items.push({ type: "message", index: offset + position });
  });
  flush();
  return items;
}

function isHidden(message: TranscriptMessage, tools: Record<string, ToolCall>): boolean {
  if (message.content.length === 0) return true;
  return message.role === "toolResult" && !!message.toolCallId && !!tools[message.toolCallId];
}

/** Returns the tool call ids when every block is a thinking block or a tool call that has a card. */
function getToolStep(message: TranscriptMessage, tools: Record<string, ToolCall>): string[] | undefined {
  if (message.role !== "assistant") return;
  const toolCallIds: string[] = [];
  for (const block of message.content) {
    if (block.type === "thinking") continue;
    if (!block.toolCall || !tools[block.toolCall.id]) return;
    toolCallIds.push(block.toolCall.id);
  }
  return toolCallIds.length ? toolCallIds : undefined;
}
