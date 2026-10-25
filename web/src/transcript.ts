import type { AgentSessionEvent } from "../../server/src/pi-adapter.ts";

export interface TranscriptBlock {
  type: "text" | "thinking" | "toolCall";
  text: string;
}

export interface TranscriptMessage {
  role: string;
  content: TranscriptBlock[];
}

export class Transcript {
  messages: TranscriptMessage[] = [];
  is_running = false;
  active: TranscriptMessage | undefined;

  apply(event: AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start": this.is_running = true; break;
      case "agent_settled": this.is_running = false; break;
      case "message_start": this.start(event.message); break;
      case "message_update": this.update(event); break;
      case "message_end": this.end(event.message); break;
    }
  }

  start(message: { role: string; content?: unknown }): void {
    if (message.role === "system") return;
    this.active = { role: message.role, content: getBlocks(message.content) };
    this.messages.push(this.active);
  }

  update(event: Extract<AgentSessionEvent, { type: "message_update" }>): void {
    if (!this.active) return;
    const update = event.assistantMessageEvent;
    if (update.type !== "text_delta" && update.type !== "thinking_delta") return;
    const type = update.type === "text_delta" ? "text" : "thinking";
    const content = this.active.content;
    content[update.contentIndex] ??= { type, text: "" };
    content[update.contentIndex].text += update.delta;
  }

  end(message: { role: string; content?: unknown }): void {
    if (message.role === "system") return;
    if (!this.active) this.start(message);
    this.active!.content = getBlocks(message.content);
    this.active = undefined;
  }
}

function getBlocks(content: unknown): TranscriptBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.map((block): TranscriptBlock => {
    switch (block.type) {
      case "text": return { type: "text", text: block.text };
      case "thinking": return { type: "thinking", text: block.thinking };
      case "toolCall": return { type: "toolCall", text: `${block.name} ${JSON.stringify(block.arguments)}` };
      default: return { type: "text", text: "" };
    }
  });
}
