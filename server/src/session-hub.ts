import type { Configuration } from "./config.ts";
import { OpenSession, type HubClient, type HubSession, type RunMetrics } from "./open-session.ts";
import type { PiAdapter } from "./pi-adapter.ts";
import { lastUserActivity, type ProjectGroup, type PromptImage, type SessionListItem } from "./protocol.ts";
import { ProjectStore } from "./project-store.ts";
import type { PushNotifier } from "./push-notifier.ts";

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
  private readonly notifier?: Pick<PushNotifier, "notify">;
  private readonly sessions = new Map<string, OpenSession>();
  private readonly opening = new Map<string, Promise<OpenSession>>();
  // One draft session per project. A draft has no messages and is reused by the next New session click.
  private readonly drafts = new Map<string, string>();
  private readonly creating = new Map<string, Promise<string>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly clients = new Set<HubClient>();
  private listBroadcast?: ReturnType<typeof setTimeout>;

  constructor(
    source: SessionSource,
    configuration: Pick<Configuration, "projectsRoot" | "idleMinutes">,
    logRun: (metrics: RunMetrics) => void = (metrics) => console.log(JSON.stringify(metrics)),
    store = new ProjectStore(configuration.projectsRoot),
    notifier?: Pick<PushNotifier, "notify">,
  ) {
    this.store = store;
    this.notifier = notifier;
    this.source = source;
    this.configuration = configuration;
    this.logRun = logRun;
  }

  async getSessionList() {
    const projects: ProjectGroup[] = await Promise.all(
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
    const pending = this.creating.get(project);
    if (pending) return pending;
    const draftId = this.drafts.get(project);
    if (draftId) {
      const draft = this.sessions.get(draftId);
      if (draft?.project === project && !draft.session.is_running && !draft.session.snapshot.messages.length)
        return draftId;
      this.drafts.delete(project);
    }
    const created = this.source
      .create(project)
      .then((session) => {
        const entry = this.register(project, session);
        this.drafts.set(project, entry.id);
        return entry.id;
      })
      .finally(() => this.creating.delete(project));
    this.creating.set(project, created);
    return created;
  }

  async subscribe(client: HubClient, sessionId: string): Promise<void> {
    const entry = await this.getSession(sessionId);
    entry.subscribers.add(client);
    entry.sendSnapshot([client]);
  }
  unsubscribe(client: HubClient, sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry?.subscribers.delete(client)) return;
    this.scheduleDisposal(entry);
  }

  /** Every connected socket registers here, so list updates can reach them all. */
  addClient(client: HubClient): void {
    this.clients.add(client);
  }

  removeClient(client: HubClient): void {
    this.clients.delete(client);
    for (const entry of this.sessions.values()) this.unsubscribe(client, entry.id);
  }

  async prompt(sessionId: string, text: string, images?: PromptImage[]): Promise<void> {
    await (await this.getSession(sessionId)).session.prompt(text, images);
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

  async rename(sessionId: string, name: string): Promise<void> {
    (await this.getSession(sessionId)).session.rename(name);
  }

  async getSessionInfo(sessionId: string) {
    return (await this.getSession(sessionId)).session.info;
  }

  async compact(sessionId: string, instructions?: string): Promise<void> {
    const entry = await this.getSession(sessionId);
    await entry.session.compact(instructions);
    entry.sendSnapshot();
  }

  async close(): Promise<void> {
    clearTimeout(this.listBroadcast);
    this.listBroadcast = undefined;
    this.drafts.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all([...this.sessions.values()].map((entry) => entry.close()));
    this.sessions.clear();
  }

  private async getProjects(): Promise<string[]> {
    return this.store.list();
  }

  private async getProjectSessions(project: string): Promise<SessionListItem[]> {
    const stored = await this.source.list(project);
    const open = [...this.sessions.values()].filter((entry) => entry.project === project);
    const storedIds = new Set(stored.map((summary) => summary.id));
    const summaries: Omit<SessionListItem, "isRunning">[] = [
      ...stored.map(({ id, name, firstMessage, modified, lastUserMessage }) => ({
        id,
        name,
        firstMessage,
        modified,
        lastUserMessage,
      })),
      ...open
        .filter((entry) => !storedIds.has(entry.id))
        .map((entry) => ({
          id: entry.id,
          name: undefined,
          firstMessage: "",
          modified: entry.openedAt,
          lastUserMessage: undefined,
        })),
    ];
    return summaries
      .sort((a, b) => lastUserActivity(b) - lastUserActivity(a))
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
    const entry = new OpenSession(
      project,
      session,
      this.logRun,
      (notice) => {
        this.scheduleDisposal(entry);
        this.notifier?.notify(notice).catch((error: unknown) => console.error("Push notification failed", error));
      },
      (event) => {
        if (event.type === "agent_start") this.clearDraft(entry);
        this.scheduleListBroadcast();
      },
    );
    this.sessions.set(entry.id, entry);
    this.scheduleDisposal(entry);
    this.scheduleListBroadcast();
    return entry;
  }

  /** Sends one session list to every client when run state, names, or open sessions change. */
  private scheduleListBroadcast(): void {
    if (this.listBroadcast) return;
    this.listBroadcast = setTimeout(() => {
      this.listBroadcast = undefined;
      void this.getSessionList()
        .then((list) => {
          // The push flag marks this as an update, so clients can tell it from a command reply.
          const message = JSON.stringify({ ...list, push: true });
          for (const client of this.clients) client.send(message);
        })
        .catch((error: unknown) => console.error("Session list broadcast failed", error));
    }, 100);
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
    this.clearDraft(entry);
    await entry.close();
  }

  private clearDraft(entry: OpenSession): void {
    if (this.drafts.get(entry.project) === entry.id) this.drafts.delete(entry.project);
  }

  private async disposeIfIdle(entry: OpenSession): Promise<void> {
    if (!entry.is_idle || this.sessions.get(entry.id) !== entry) return;
    await this.forget(entry);
    this.scheduleListBroadcast();
  }
}
