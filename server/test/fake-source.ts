import type { AgentSessionEvent, Snapshot } from "../src/pi-adapter.ts";
import type { HubSession, SessionSource } from "../src/session-hub.ts";

export class FakeSession implements HubSession {
  is_running = false;
  closed = false;
  listener: (event: AgentSessionEvent) => void = () => {};
  finish: () => void = () => {};

  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  get snapshot(): Snapshot {
    return { messages: [], isStreaming: this.is_running, queue: { steering: [], followUp: [] } };
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listener = listener;
    return () => { this.listener = () => {}; };
  }

  async prompt(): Promise<void> {
    if (this.is_running) throw new Error("A run is already active.");
    this.is_running = true;
    this.listener({ type: "agent_start" });
    await new Promise<void>((resolve) => { this.finish = resolve; });
    this.is_running = false;
    this.listener({ type: "agent_settled", aborted: false });
  }

  async abort(): Promise<void> {
    this.finish();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.finish();
  }
}

export class FakeSource implements SessionSource {
  readonly sessions = new Map<string, FakeSession>();
  readonly stored: { id: string; path: string; project: string; firstMessage: string; modified: number }[] = [];
  count = 0;

  async list(project: string) {
    return this.stored.filter((item) => item.project === project);
  }

  async create(): Promise<FakeSession> {
    return this.track(new FakeSession(`new-${++this.count}`));
  }

  async open(_project: string, path: string): Promise<FakeSession> {
    return this.track(new FakeSession(this.stored.find((item) => item.path === path)!.id));
  }

  private track(session: FakeSession): FakeSession {
    this.sessions.set(session.id, session);
    return session;
  }
}
