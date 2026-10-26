import type { AgentSessionEvent, Snapshot } from "../../server/src/pi-adapter.ts";

import { getToolDiff, getToolOutput, type ToolCall } from "./tools.ts";

export interface TranscriptBlock {
  type: "text" | "thinking" | "toolCall";
  text: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
}

export interface TranscriptMessage {
  role: string;
  timestamp?: number;
  toolCallId?: string;
  content: TranscriptBlock[];
}

export class Transcript {
  messages: TranscriptMessage[] = [];
  is_running = false;
  tools: Record<string, ToolCall> = {};
  queue: Snapshot["queue"] = { steering: [], followUp: [] };
  active: TranscriptMessage | undefined;

  apply(event: AgentSessionEvent): void {
    if (event.type.startsWith("tool_execution_")) return this.applyTool(event);
    switch (event.type) {
      case "agent_start":
        this.is_running = true;
        break;
      case "agent_settled":
        this.settle();
        break;
      case "queue_update":
        this.queue = { steering: [...event.steering], followUp: [...event.followUp] };
        break;
      case "message_start":
        this.start(event.message);
        break;
      case "message_update":
        this.update(event);
        break;
      case "message_end":
        this.end(event.message);
        break;
    }
  }

  isGroupStart(index: number): boolean {
    const current = this.messages[index];
    const previous = this.messages[index - 1];
    return !previous || getSender(previous.role) !== getSender(current.role);
  }

  load(snapshot: Snapshot & { runEvents: AgentSessionEvent[] }): void {
    this.messages = [];
    this.tools = {};
    this.queue = { steering: [...snapshot.queue.steering], followUp: [...snapshot.queue.followUp] };
    this.active = undefined;
    for (const message of snapshot.messages) {
      this.start(message);
      this.end(message);
    }
    for (const event of snapshot.runEvents) this.apply(event);
    this.is_running = snapshot.isStreaming;
    if (!snapshot.isStreaming) this.settle();
  }

  start(message: {
    role: string;
    content?: unknown;
    timestamp?: number;
    toolCallId?: string;
    isError?: boolean;
    details?: unknown;
  }): void {
    if (message.role === "system") return;
    this.active = {
      role: message.role,
      timestamp: message.timestamp,
      toolCallId: message.toolCallId,
      content: getBlocks(message.content),
    };
    this.registerTools(this.active);
    this.messages.push(this.active);
  }

  update(event: Extract<AgentSessionEvent, { type: "message_update" }>): void {
    if (!this.active) return;
    const update = event.assistantMessageEvent;
    if (update.type.startsWith("toolcall_") && "partial" in update) {
      this.active.content = getBlocks(update.partial.content);
      this.registerTools(this.active);
      return;
    }
    if (update.type !== "text_delta" && update.type !== "thinking_delta") return;
    const type = update.type === "text_delta" ? "text" : "thinking";
    const content = this.active.content;
    content[update.contentIndex] ??= { type, text: "" };
    content[update.contentIndex].text += update.delta;
  }

  end(message: {
    role: string;
    content?: unknown;
    timestamp?: number;
    toolCallId?: string;
    isError?: boolean;
    details?: unknown;
  }): void {
    if (message.role === "system") return;
    if (!this.active) this.start(message);
    this.active!.content = getBlocks(message.content);
    this.active!.timestamp = message.timestamp ?? this.active!.timestamp;
    this.registerTools(this.active!);
    if (message.role === "toolResult" && message.toolCallId) {
      this.updateTool(message.toolCallId, message, message.isError ?? false);
    }
    this.active = undefined;
  }

  private applyTool(event: AgentSessionEvent): void {
    switch (event.type) {
      case "tool_execution_start":
        this.startTool(event);
        break;
      case "tool_execution_update":
        this.updateTool(event.toolCallId, event.partialResult);
        break;
      case "tool_execution_end":
        this.updateTool(event.toolCallId, event.result, event.isError);
        break;
    }
  }

  private registerTools(message: TranscriptMessage): void {
    for (const block of message.content) {
      const call = block.toolCall;
      if (!call) continue;
      this.tools[call.id] ??= { ...call, status: "pending", output: "" };
      this.tools[call.id].arguments = call.arguments;
    }
  }

  private startTool(event: Extract<AgentSessionEvent, { type: "tool_execution_start" }>): void {
    this.tools[event.toolCallId] = {
      id: event.toolCallId,
      name: event.toolName,
      arguments: event.args,
      status: "running",
      output: "",
    };
  }

  private updateTool(id: string, result: unknown, isError?: boolean): void {
    const tool = this.tools[id];
    if (!tool) return;
    tool.output = getToolOutput(result);
    tool.diff = getToolDiff(result);
    if (isError !== undefined) tool.status = isError ? "error" : "success";
  }

  private settle(): void {
    this.is_running = false;
    for (const tool of Object.values(this.tools)) {
      if (tool.status === "running" || tool.status === "pending") tool.status = "interrupted";
    }
  }
}

export function getSender(role: string): "You" | "pi" {
  return role === "user" ? "You" : "pi";
}

function getBlocks(content: unknown): TranscriptBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.map((block): TranscriptBlock => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "thinking":
        return { type: "thinking", text: block.thinking };
      case "toolCall":
        return {
          type: "toolCall",
          text: `${block.name} ${JSON.stringify(block.arguments)}`,
          toolCall: { id: block.id, name: block.name, arguments: block.arguments ?? {} },
        };
      default:
        return { type: "text", text: "" };
    }
  });
}
