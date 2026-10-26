import type { Configuration } from "./config.ts";
import { OpenSession, type HubClient, type HubSession, type RunMetrics } from "./open-session.ts";
import type { PiAdapter } from "./pi-adapter.ts";
import { ProjectStore } from "./project-store.ts";

export type { HubClient, HubSession, RunMetrics } from "./open-session.ts";

export interface SessionSource {
  list: PiAdapter["list"];
  delete: PiAdapter["delete"];
  create(project: string): Promise<HubSession>;
  open(project: string, path: string): Promise<HubSession>;
}

export class SessionHub {
  private readonly source: SessionSource;
  private readonly configuration: Pick<Configuration, "projectsRoot" | "idleMinutes">;
  private readonly logRun: (metrics: RunMetrics) => void;
  private readonly store: ProjectStore;
  private readonly sessions = new Map<string, OpenSession>();
  private readonly opening = new Map<string, Promise<OpenSession>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    source: SessionSource,
    configuration: Pick<Configuration, "projectsRoot" | "idleMinutes">,
    logRun: (metrics: RunMetrics) => void = (metrics) => console.log(JSON.stringify(metrics)),
    store = new ProjectStore(configuration.projectsRoot),
  ) {
    this.store = store;
    this.source = source;
    this.configuration = configuration;
    this.logRun = logRun;
  }

  async getSessionList() {
    const projects = await Promise.all(
      (await this.getProjects()).map(async (path) => ({
        path,
        sessions: await this.getProjectSessions(path),
      })),
    );
    return { type: "sessions", projects, groupsRoot: this.store.root };
  }

  createGroup(name: string): Promise<string> {
    return this.store.create(name);
  }

  async removeGroup(project: string, isDeletingFolder = false): Promise<void> {
    const open = [...this.sessions.values()].filter((entry) => entry.project === project);
    if (open.some((entry) => entry.session.is_running)) throw new Error("A session in this project is still running.");
    await this.store.remove(project, isDeletingFolder);
    for (const entry of open) await this.forget(entry);
  }

  async deleteSessions(sessionIds: string[]): Promise<void> {
    const open = sessionIds.map((id) => this.sessions.get(id)).filter((entry) => entry !== undefined);
    if (open.some((entry) => entry.session.is_running)) throw new Error("A selected session is still running.");
    for (const entry of open) await this.forget(entry);
    for (const project of await this.getProjects()) {
      const stored = await this.source.list(project);
      for (const summary of stored.filter((item) => sessionIds.includes(item.id))) {
        await this.source.delete(project, summary.id);
      }
    }
  }

  async createSession(project: string): Promise<string> {
    if (!(await this.getProjects()).includes(project)) throw new Error("Unknown project.");
    return this.register(project, await this.source.create(project)).id;
  }

  async subscribe(client: HubClient, sessionId: string): Promise<void> {
    const entry = await this.getSession(sessionId);
    entry.subscribers.add(client);
    client.send(JSON.stringify(entry.snapshot));
  }

  unsubscribe(client: HubClient, sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry?.subscribers.delete(client)) return;
    this.scheduleDisposal(entry);
  }

  removeClient(client: HubClient): void {
    for (const entry of this.sessions.values()) this.unsubscribe(client, entry.id);
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await (await this.getSession(sessionId)).session.prompt(text);
  }

  async abort(sessionId: string): Promise<void> {
    await (await this.getSession(sessionId)).session.abort();
  }

  async queue(sessionId: string, text: string, mode: "steer" | "follow_up"): Promise<void> {
    await (await this.getSession(sessionId)).session.queue(text, mode);
  }

  async steerFollowUp(sessionId: string, text: string): Promise<void> {
    (await this.getSession(sessionId)).session.steerFollowUp(text);
  }

  async setModel(sessionId: string, provider: string, id: string): Promise<void> {
    const entry = await this.getSession(sessionId);
    await entry.session.setModel(provider, id);
    entry.sendSnapshot();
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    const entry = await this.getSession(sessionId);
    entry.session.setThinkingLevel(level);
    entry.sendSnapshot();
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all([...this.sessions.values()].map((entry) => entry.close()));
    this.sessions.clear();
  }

  private async getProjects(): Promise<string[]> {
    return this.store.list();
  }

  private async getProjectSessions(project: string) {
    const stored = await this.source.list(project);
    const open = [...this.sessions.values()].filter((entry) => entry.project === project);
    const storedIds = new Set(stored.map((summary) => summary.id));
    const summaries = [
      ...stored.map(({ id, name, firstMessage, modified }) => ({ id, name, firstMessage, modified })),
      ...open
        .filter((entry) => !storedIds.has(entry.id))
        .map((entry) => ({ id: entry.id, name: undefined, firstMessage: "", modified: entry.openedAt })),
    ];
    return summaries
      .sort((a, b) => b.modified - a.modified)
      .map((summary) => ({ ...summary, isRunning: this.sessions.get(summary.id)?.session.is_running ?? false }));
  }

  private getSession(sessionId: string): Promise<OpenSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return Promise.resolve(existing);
    if (!this.opening.has(sessionId)) {
      const opening = this.openStored(sessionId).finally(() => this.opening.delete(sessionId));
      this.opening.set(sessionId, opening);
    }
    return this.opening.get(sessionId)!;
  }

  private async openStored(sessionId: string): Promise<OpenSession> {
    for (const project of await this.getProjects()) {
      const found = (await this.source.list(project)).find((summary) => summary.id === sessionId);
      if (found) return this.register(project, await this.source.open(project, found.path));
    }
    throw new Error("Unknown session.");
  }

  private register(project: string, session: HubSession): OpenSession {
    const entry = new OpenSession(project, session, this.logRun, () => this.scheduleDisposal(entry));
    this.sessions.set(entry.id, entry);
    this.scheduleDisposal(entry);
    return entry;
  }

  private scheduleDisposal(entry: OpenSession): void {
    clearTimeout(this.timers.get(entry.id));
    const timer = setTimeout(() => void this.disposeIfIdle(entry), this.configuration.idleMinutes * 60_000);
    timer.unref();
    this.timers.set(entry.id, timer);
  }

  private async forget(entry: OpenSession): Promise<void> {
    clearTimeout(this.timers.get(entry.id));
    this.timers.delete(entry.id);
    this.sessions.delete(entry.id);
    await entry.close();
  }

  private async disposeIfIdle(entry: OpenSession): Promise<void> {
    if (!entry.is_idle || this.sessions.get(entry.id) !== entry) return;
    await this.forget(entry);
  }
}
