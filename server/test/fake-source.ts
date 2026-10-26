import type { AgentSessionEvent, SessionInfo, SessionSettings, Snapshot } from "../src/pi-adapter.ts";
import type { HubSession, SessionSource } from "../src/session-hub.ts";

export class FakeSession implements HubSession {
  is_running = false;
  closed = false;
  name: string | undefined;
  compactions: (string | undefined)[] = [];
  messages: Snapshot["messages"] = [];
  pending = { steering: [] as string[], followUp: [] as string[] };
  settings: SessionSettings = {
    model: { provider: "faux", id: "first", name: "First" },
    models: [
      { provider: "faux", id: "first", name: "First" },
      { provider: "faux", id: "second", name: "Second" },
    ],
    thinkingLevel: "off",
    thinkingLevels: ["off", "high"],
    commands: [{ name: "review", description: "Review the diff" }],
  };
  listener: (event: AgentSessionEvent) => void = () => {};
  finish: () => void = () => {};

  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  get snapshot(): Snapshot {
    return {
      messages: this.messages,
      isStreaming: this.is_running,
      isCompacting: false,
      queue: structuredClone(this.pending),
      settings: this.settings,
    };
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = () => {};
    };
  }

  async prompt(): Promise<void> {
    if (this.is_running) throw new Error("A run is already active.");
    this.is_running = true;
    this.listener({ type: "agent_start" });
    await new Promise<void>((resolve) => {
      this.finish = resolve;
    });
    this.is_running = false;
    this.listener({ type: "agent_settled", aborted: false });
  }

  async queue(text: string, mode: "steer" | "follow_up"): Promise<void> {
    if (!this.is_running) return this.prompt();
    this.pending[mode === "steer" ? "steering" : "followUp"].push(text);
    this.listener({ type: "queue_update", ...this.pending });
  }

  steerFollowUp(text: string): void {
    const index = this.pending.followUp.indexOf(text);
    if (index === -1) throw new Error("This message is no longer queued.");
    this.pending.followUp.splice(index, 1);
    this.pending.steering.push(text);
    this.listener({ type: "queue_update", ...this.pending });
  }

  async setModel(provider: string, id: string): Promise<void> {
    if (this.is_running) throw new Error("Change settings when the session is idle.");
    const model = this.settings.models.find((choice) => choice.provider === provider && choice.id === id);
    if (!model) throw new Error("Unknown or unavailable model.");
    this.settings.model = model;
  }

  setThinkingLevel(level: string): void {
    if (this.is_running) throw new Error("Change settings when the session is idle.");
    if (!this.settings.thinkingLevels.includes(level)) throw new Error("Unsupported thinking level.");
    this.settings.thinkingLevel = level;
  }

  rename(name: string): void {
    this.name = name;
    this.listener({ type: "session_info_changed", name });
  }

  get info(): SessionInfo {
    return {
      sessionId: this.id,
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 2,
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
      cost: 0.01,
    };
  }

  async compact(instructions?: string): Promise<void> {
    if (this.is_running) throw new Error("Change settings when the session is idle.");
    this.compactions.push(instructions);
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

  async delete(_project: string, sessionId: string): Promise<void> {
    this.stored.splice(
      this.stored.findIndex((item) => item.id === sessionId),
      1,
    );
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
