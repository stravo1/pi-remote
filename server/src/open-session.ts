import type { AgentSessionEvent, PiSession, Snapshot } from "./pi-adapter.ts";
import type { RunNotice } from "./push-notifier.ts";

export interface HubClient {
  send(message: string): void;
}

export type HubSession = Pick<
  PiSession,
  | "id"
  | "is_running"
  | "snapshot"
  | "prompt"
  | "queue"
  | "steerFollowUp"
  | "setModel"
  | "setThinkingLevel"
  | "name"
  | "rename"
  | "info"
  | "compact"
  | "abort"
  | "subscribe"
  | "close"
>;

export interface RunMetrics {
  type: "run";
  sessionId: string;
  eventCount: number;
  bytes: number;
}

export class OpenSession {
  readonly project: string;
  readonly session: HubSession;
  readonly subscribers = new Set<HubClient>();
  readonly openedAt = Date.now();
  private readonly unsubscribe: () => void;
  private readonly logRun: (metrics: RunMetrics) => void;
  private readonly onSettled: (notice: RunNotice) => void;
  private readonly onChange: () => void;
  private runEvents: AgentSessionEvent[] = [];
  private sequence = 0;
  private eventCount = 0;
  private bytes = 0;

  constructor(
    project: string,
    session: HubSession,
    logRun: (metrics: RunMetrics) => void,
    onSettled: (notice: RunNotice) => void,
    onChange: () => void = () => {},
  ) {
    this.project = project;
    this.session = session;
    this.logRun = logRun;
    this.onSettled = onSettled;
    this.onChange = onChange;
    this.unsubscribe = session.subscribe((event) => this.broadcast(event));
  }

  get id(): string {
    return this.session.id;
  }

  get is_idle(): boolean {
    return !this.session.is_running && this.subscribers.size === 0;
  }

  get snapshot(): { type: "snapshot"; sessionId: string; runEvents: AgentSessionEvent[]; seq: number } & Snapshot {
    return {
      type: "snapshot",
      sessionId: this.id,
      ...this.session.snapshot,
      runEvents: [...this.runEvents],
      seq: this.sequence,
    };
  }

  broadcast(event: AgentSessionEvent): void {
    if (event.type === "agent_start") this.eventCount = this.bytes = 0;
    const message = JSON.stringify({ type: "event", sessionId: this.id, seq: ++this.sequence, event });
    this.eventCount++;
    for (const client of this.subscribers) {
      client.send(message);
      this.bytes += Buffer.byteLength(message);
    }
    this.record(event);
    // Run state and names show on the session list, so the list needs a refresh.
    if (["agent_start", "agent_settled", "session_info_changed"].includes(event.type)) this.onChange();
  }

  sendSnapshot(clients: Iterable<HubClient> = this.subscribers): void {
    const message = JSON.stringify(this.snapshot);
    for (const client of clients) client.send(message);
  }

  async close(): Promise<void> {
    this.unsubscribe();
    this.subscribers.clear();
    await this.session.close();
  }

  private record(event: AgentSessionEvent): void {
    this.runEvents.push(event);
    if (event.type === "message_end" || event.type === "compaction_end") this.runEvents = [];
    if (event.type !== "agent_settled") return;
    this.runEvents = [];
    this.logRun({ type: "run", sessionId: this.id, eventCount: this.eventCount, bytes: this.bytes });
    this.onSettled(this.getNotice(event.aborted));
  }

  private getNotice(isAborted: boolean): RunNotice {
    const reply = this.session.snapshot.messages.filter((message) => message.role === "assistant").at(-1);
    return {
      sessionId: this.id,
      title: this.session.name || "pi remote",
      body: isAborted ? "Stopped." : getReplyText(reply),
    };
  }
}

function getReplyText(reply: Snapshot["messages"][number] | undefined): string {
  if (reply?.role !== "assistant") return "Finished.";
  if (reply.stopReason === "error") return reply.errorMessage || "The run failed.";
  const text = reply.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 160 ? `${text.slice(0, 159)}…` : text || "Finished.";
}
