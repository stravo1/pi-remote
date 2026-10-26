import type { AgentSessionEvent, PiSession, Snapshot } from "./pi-adapter.ts";

export interface HubClient {
  send(message: string): void;
}

export type HubSession = Pick<PiSession, "id" | "is_running" | "snapshot" | "prompt" | "queue" | "setModel" | "setThinkingLevel" | "abort" | "subscribe" | "close">;

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
  private readonly onSettled: () => void;
  private runEvents: AgentSessionEvent[] = [];
  private sequence = 0;
  private eventCount = 0;
  private bytes = 0;

  constructor(project: string, session: HubSession, logRun: (metrics: RunMetrics) => void, onSettled: () => void) {
    this.project = project;
    this.session = session;
    this.logRun = logRun;
    this.onSettled = onSettled;
    this.unsubscribe = session.subscribe((event) => this.broadcast(event));
  }

  get id(): string {
    return this.session.id;
  }

  get is_idle(): boolean {
    return !this.session.is_running && this.subscribers.size === 0;
  }

  get snapshot(): { type: "snapshot"; sessionId: string; runEvents: AgentSessionEvent[]; seq: number } & Snapshot {
    return { type: "snapshot", sessionId: this.id, ...this.session.snapshot, runEvents: [...this.runEvents], seq: this.sequence };
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
  }

  sendSnapshot(): void {
    const message = JSON.stringify(this.snapshot);
    for (const client of this.subscribers) client.send(message);
  }

  async close(): Promise<void> {
    this.unsubscribe();
    this.subscribers.clear();
    await this.session.close();
  }

  private record(event: AgentSessionEvent): void {
    this.runEvents.push(event);
    if (event.type === "message_end") this.runEvents = [];
    if (event.type !== "agent_settled") return;
    this.runEvents = [];
    this.logRun({ type: "run", sessionId: this.id, eventCount: this.eventCount, bytes: this.bytes });
    this.onSettled();
  }
}
