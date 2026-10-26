import type { SessionSettings } from "../../server/src/pi-adapter.ts";
import { Connection } from "./connection.ts";
import type { ConnectionStatus, ProjectGroup, SessionItem } from "./protocol.ts";
import { Transcript } from "./transcript.ts";

export class Workspace {
  status: ConnectionStatus = "connecting";
  projects: ProjectGroup[] = [];
  groupsRoot?: string;
  lastGroup = "";
  sessionId = "";
  transcript = new Transcript();
  error = "";
  isSending = false;
  isUpdatingSettings = false;
  settings?: SessionSettings;
  private isSyncing = false;
  private lastSequence = 0;
  private connection?: Connection;

  get activeSession(): SessionItem | undefined {
    return this.projects.flatMap((project) => project.sessions).find((session) => session.id === this.sessionId);
  }

  get activeProjectPath(): string | undefined {
    const project = this.projects.find((group) => group.sessions.some((session) => session.id === this.sessionId));
    return (project ?? this.projects[0])?.path;
  }

  get is_disabled(): boolean {
    return this.status !== "connected" || !this.sessionId || this.isSyncing
      || this.isSending || this.isUpdatingSettings;
  }

  start(): void {
    this.sessionId = location.hash.slice(1);
    this.connection = new Connection({
      onStatus: (status) => { this.status = status; },
      onOpen: () => { this.refreshList(); this.subscribe(); },
      onMessage: (message) => this.handle(message),
    });
    this.connection.connect();
    window.addEventListener("hashchange", () => this.select(location.hash.slice(1)));
    document.addEventListener("visibilitychange", () => this.wake());
  }

  select(sessionId: string): void {
    if (sessionId === this.sessionId) return;
    if (this.sessionId) this.run({ type: "unsubscribe", sessionId: this.sessionId });
    this.sessionId = sessionId;
    if (location.hash.slice(1) !== sessionId) location.hash = sessionId;
    this.transcript = new Transcript();
    this.settings = undefined;
    this.isSending = false;
    this.isUpdatingSettings = false;
    this.subscribe();
  }

  createSession(project: string): void {
    this.run({ type: "new_session", project });
  }

  createGroup(name: string): void {
    this.error = "";
    this.run({ type: "new_group", name });
  }

  sendPrompt(text: string, mode: "follow_up" | "steer" = "follow_up"): void {
    this.isSending = true;
    this.error = "";
    this.run({ type: this.transcript.is_running ? mode : "prompt", sessionId: this.sessionId, text });
  }

  setModel(value: string): void {
    const model = this.settings?.models.find((choice) => JSON.stringify([choice.provider, choice.id]) === value);
    if (!model) return;
    this.isUpdatingSettings = true;
    this.error = "";
    this.run({ type: "set_model", sessionId: this.sessionId, provider: model.provider, modelId: model.id });
  }

  setThinkingLevel(level: string): void {
    this.isUpdatingSettings = true;
    this.error = "";
    this.run({ type: "set_thinking_level", sessionId: this.sessionId, level });
  }

  abort(): void {
    this.run({ type: "abort", sessionId: this.sessionId });
  }

  handle(message: any): void {
    switch (message.type) {
      case "sessions": this.projects = message.projects; this.groupsRoot = message.groupsRoot; break;
      case "group_created": this.lastGroup = message.project; this.createSession(message.project); break;
      case "session_created": this.refreshList(); this.select(message.sessionId); break;
      case "snapshot": this.applySnapshot(message); break;
      case "event": this.applyEvent(message); break;
      case "error":
        if (message.sessionId && message.sessionId !== this.sessionId) break;
        this.isSending = false; this.isUpdatingSettings = false; this.error = message.message; break;
    }
  }

  private applySnapshot(message: any): void {
    if (message.sessionId !== this.sessionId) return;
    this.transcript.load(message);
    this.settings = message.settings;
    this.isUpdatingSettings = false;
    this.lastSequence = message.seq;
    this.isSyncing = false;
    this.isSending = false;
  }

  private applyEvent(message: any): void {
    if (message.sessionId !== this.sessionId || this.isSyncing) return;
    if (message.seq !== this.lastSequence + 1) return this.subscribe();
    this.lastSequence = message.seq;
    this.isSending = false;
    this.transcript.apply(message.event);
    if (message.event.type === "agent_settled" || message.event.type === "agent_start") this.refreshList();
  }

  private subscribe(): void {
    if (!this.sessionId) return;
    this.isSyncing = true;
    this.run({ type: "subscribe", sessionId: this.sessionId });
  }

  private refreshList(): void {
    this.run({ type: "list_sessions" });
  }

  private wake(): void {
    if (document.visibilityState !== "visible") return;
    if (this.status === "disconnected") this.connection?.reconnectNow();
    else this.refreshList();
  }

  private run(command: object): void {
    try {
      this.connection!.send(command);
    } catch (error) {
      this.isSending = false;
      this.isUpdatingSettings = false;
      this.error = error instanceof Error ? error.message : "The command failed.";
    }
  }
}
