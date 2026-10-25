import { Connection } from "./connection.ts";
import type { ConnectionStatus, ProjectGroup, SessionItem } from "./protocol.ts";
import { Transcript } from "./transcript.ts";

export class Workspace {
  status: ConnectionStatus = "connecting";
  projects: ProjectGroup[] = [];
  sessionId = "";
  transcript = new Transcript();
  error = "";
  isSending = false;
  private isSyncing = false;
  private lastSequence = 0;
  private connection?: Connection;

  get activeSession(): SessionItem | undefined {
    return this.projects.flatMap((project) => project.sessions).find((session) => session.id === this.sessionId);
  }

  get is_disabled(): boolean {
    return this.status !== "connected" || !this.sessionId || this.isSyncing
      || this.transcript.is_running || this.isSending;
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
    this.subscribe();
  }

  createSession(project: string): void {
    this.run({ type: "new_session", project });
  }

  sendPrompt(text: string): void {
    this.isSending = true;
    this.error = "";
    this.run({ type: "prompt", sessionId: this.sessionId, text });
  }

  abort(): void {
    this.run({ type: "abort", sessionId: this.sessionId });
  }

  handle(message: any): void {
    switch (message.type) {
      case "sessions": this.projects = message.projects; break;
      case "session_created": this.refreshList(); this.select(message.sessionId); break;
      case "snapshot": this.applySnapshot(message); break;
      case "event": this.applyEvent(message); break;
      case "error": this.isSending = false; this.error = message.message; break;
    }
  }

  private applySnapshot(message: any): void {
    if (message.sessionId !== this.sessionId) return;
    this.transcript.load(message);
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
      this.error = error instanceof Error ? error.message : "The command failed.";
    }
  }
}
