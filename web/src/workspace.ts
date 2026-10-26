import type { ProviderLoginEvent, ProviderSettings, SessionSettings } from "../../server/src/pi-adapter.ts";
import { Connection } from "./connection.ts";
import type { ConnectionStatus, ProjectGroup, SessionItem } from "./protocol.ts";
import { DevicePush } from "./push.ts";
import { formatSessionInfo } from "./session-info.ts";
import { Transcript } from "./transcript.ts";

export class Workspace {
  status: ConnectionStatus = "connecting";
  projects: ProjectGroup[] = [];
  hasSessionList = false;
  groupsRoot?: string;
  lastGroup = "";
  sessionId = "";
  transcript = new Transcript();
  error = "";
  isSending = false;
  isUpdatingSettings = false;
  settings?: SessionSettings;
  private pendingName?: string;
  providers: ProviderSettings[] = [];
  providerLogin?: { id?: string; event?: ProviderLoginEvent; notice?: ProviderLoginEvent };
  providerKey?: { provider: string; apiKey: string };
  isSyncing = false;
  devicePush = new DevicePush();
  // null means the server has no push settings. undefined means it has not answered yet.
  pushKey?: string | null;
  isPushOn = false;
  isUpdatingPush = false;
  private lastSequence = 0;
  private connection?: Connection;

  get activeSession(): SessionItem | undefined {
    return this.projects.flatMap((project) => project.sessions).find((session) => session.id === this.sessionId);
  }

  get activeProjectPath(): string | undefined {
    const project = this.projects.find((group) => group.sessions.some((session) => session.id === this.sessionId));
    return (project ?? this.projects[0])?.path;
  }

  /** Only a model that accepts images shows the attach button, and only while idle. */
  get canSendImages(): boolean {
    return !!this.settings?.model?.hasImageInput && !this.transcript.is_running;
  }

  get is_disabled(): boolean {
    return (
      this.status !== "connected" ||
      !this.sessionId ||
      this.isSyncing ||
      this.isSending ||
      this.isUpdatingSettings ||
      this.transcript.is_compacting
    );
  }

  start(): void {
    this.sessionId = this.getHashSessionId();
    this.connection = new Connection({
      onStatus: (status) => {
        this.status = status;
      },
      onOpen: () => {
        this.refreshList();
        this.subscribe();
      },
      onMessage: (message) => this.handle(message),
    });
    this.connection.connect();
    window.addEventListener("hashchange", () => this.select(this.getHashSessionId()));
    document.addEventListener("visibilitychange", () => this.wake());
  }

  select(sessionId: string): void {
    if (sessionId === this.sessionId) return;
    if (this.sessionId) this.run({ type: "unsubscribe", sessionId: this.sessionId });
    this.sessionId = sessionId;
    if (location.hash.slice(1) !== sessionId) location.hash = sessionId;
    this.transcript = new Transcript();
    this.settings = undefined;
    this.pendingName = undefined;
    this.isSending = false;
    this.isUpdatingSettings = false;
    this.subscribe();
    // The list may have changed while this client was inside a session.
    if (!sessionId) this.refreshList();
  }

  createSession(project: string): void {
    this.run({ type: "new_session", project });
  }

  deleteSessions(sessionIds: string[]): void {
    this.error = "";
    this.run({ type: "delete_sessions", sessionIds });
  }

  removeGroup(project: string, deleteFolder: boolean): void {
    this.error = "";
    this.run({ type: "remove_group", project, deleteFolder });
  }

  createGroup(name: string): void {
    this.error = "";
    this.run({ type: "new_group", name });
  }

  listProviders(): void {
    this.run({ type: "list_providers" });
  }

  getProviderKey(provider: string): void {
    this.providerKey = undefined;
    this.run({ type: "get_provider_key", provider });
  }

  setProviderKey(provider: string, apiKey: string): void {
    this.error = "";
    this.providerKey = undefined;
    this.run({ type: "set_provider_key", provider, apiKey });
  }

  startProviderLogin(provider: string, authType: "api_key" | "oauth"): void {
    this.error = "";
    this.providerLogin = {};
    this.run({ type: "start_provider_login", provider, authType });
  }

  submitProviderLogin(value: string): void {
    if (!this.providerLogin?.id) return;
    this.run({ type: "submit_provider_login", loginId: this.providerLogin.id, value });
  }

  cancelProviderLogin(): void {
    if (this.providerLogin?.id) this.run({ type: "cancel_provider_login", loginId: this.providerLogin.id });
    this.providerLogin = undefined;
  }

  logoutProvider(provider: string): void {
    this.error = "";
    this.run({ type: "logout_provider", provider });
  }

  loadPush(): void {
    this.run({ type: "get_push_key" });
  }

  async enablePush(): Promise<void> {
    await this.updatePush(async () => {
      const subscription = await this.devicePush.subscribe(this.pushKey!);
      this.run({ type: "push_subscribe", subscription: subscription.toJSON() });
    });
  }

  async disablePush(): Promise<void> {
    await this.updatePush(async () => {
      const endpoint = await this.devicePush.unsubscribe(this.pushKey!);
      if (endpoint) this.run({ type: "push_unsubscribe", endpoint });
      else this.isUpdatingPush = this.isPushOn = false;
    });
  }

  testPush(): void {
    this.error = "";
    this.run({ type: "push_test" });
  }

  sendPrompt(text: string, images: { data: string; mimeType: string }[] = []): void {
    if (!images.length && this.runSlashCommand(text)) return;
    this.isSending = true;
    this.error = "";
    // Queued messages are text-only, so a send during a run leaves images out.
    const command = this.transcript.is_running
      ? { type: "follow_up", sessionId: this.sessionId, text }
      : { type: "prompt", sessionId: this.sessionId, text, images };
    this.run(command);
  }

  steerFollowUp(text: string): void {
    this.error = "";
    this.run({ type: "steer_follow_up", sessionId: this.sessionId, text });
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

  renameSession(name: string): void {
    this.error = "";
    // The server saves the name with spaces collapsed, so the note waits for that same name.
    this.pendingName = name.replace(/\s+/g, " ").trim().slice(0, 120);
    this.run({ type: "rename_session", sessionId: this.sessionId, name });
  }

  showSessionInfo(): void {
    this.error = "";
    this.run({ type: "get_session_info", sessionId: this.sessionId });
  }

  compact(instructions: string): void {
    this.error = "";
    this.run({ type: "compact", sessionId: this.sessionId, instructions });
  }

  abort(): void {
    this.run({ type: "abort", sessionId: this.sessionId });
  }

  handle(message: any): void {
    switch (message.type) {
      case "sessions":
        this.projects = message.projects;
        this.hasSessionList = true;
        this.groupsRoot = message.groupsRoot;
        break;
      case "providers":
        this.providers = message.providers;
        break;
      case "provider_key":
        this.providerKey = { provider: message.provider, apiKey: message.apiKey };
        break;
      case "provider_login_started":
        this.providerLogin = { id: message.loginId };
        break;
      case "provider_login_event":
        this.handleProviderLoginEvent(message);
        break;
      case "group_created":
        this.lastGroup = message.project;
        this.createSession(message.project);
        break;
      case "session_created":
        this.refreshList();
        this.select(message.sessionId);
        break;
      case "push_key":
        void this.applyPushKey(message.publicKey);
        break;
      case "push_subscribed":
      case "push_unsubscribed":
        this.isPushOn = message.type === "push_subscribed";
        this.isUpdatingPush = false;
        break;
      case "session_info":
        if (message.sessionId === this.sessionId) this.transcript.addNotice(formatSessionInfo(message.info));
        break;
      case "snapshot":
        this.applySnapshot(message);
        break;
      case "event":
        this.applyEvent(message);
        break;
      case "error":
        if (message.sessionId && message.sessionId !== this.sessionId) break;
        this.isSending = false;
        this.isUpdatingSettings = false;
        this.isUpdatingPush = false;
        this.error = message.message;
        break;
    }
  }

  // pi's own commands belong to its terminal app, so pi remote runs these. Other commands go to pi.
  private runSlashCommand(text: string): boolean {
    const match = /^\/(name|compact|session)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (!match) return false;
    const [, command, argument = ""] = match;
    if (command === "session") this.showSessionInfo();
    else if (command === "compact") this.compact(argument);
    else if (argument.trim()) this.renameSession(argument);
    else this.error = "Add a name after /name.";
    return true;
  }

  // The server may have lost this device, so a device that has a subscription sends it again.
  private async applyPushKey(publicKey: string | null): Promise<void> {
    this.pushKey = publicKey;
    if (!publicKey || !this.devicePush.is_supported || this.devicePush.permission !== "granted") return;
    const subscription = await this.devicePush.getSubscription(publicKey);
    this.isPushOn = !!subscription;
    if (subscription) this.run({ type: "push_subscribe", subscription: subscription.toJSON() });
  }

  private async updatePush(change: () => Promise<void>): Promise<void> {
    this.error = "";
    this.isUpdatingPush = true;
    try {
      await change();
    } catch (error) {
      this.isUpdatingPush = false;
      this.error = error instanceof Error ? error.message : "Notifications could not change.";
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
    if (message.event.type === "session_info_changed" && message.event.name === this.pendingName) {
      this.transcript.addNotice(`Renamed this session to “${this.pendingName}”.`);
      this.pendingName = undefined;
    }
    if (["agent_settled", "agent_start", "session_info_changed"].includes(message.event.type)) this.refreshList();
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

  private handleProviderLoginEvent(message: { loginId: string; event: ProviderLoginEvent }): void {
    if (this.providerLogin?.id && message.loginId !== this.providerLogin.id) return;
    const isNotice = message.event.type === "auth_url" || message.event.type === "device_code";
    this.providerLogin = {
      id: message.loginId,
      event: message.event,
      notice: isNotice ? message.event : this.providerLogin?.notice,
    };
    if (message.event.type === "failed") {
      this.error = message.event.message;
      this.providerLogin = undefined;
    }
    if (message.event.type === "complete") {
      this.providerLogin = undefined;
      this.listProviders();
    }
  }

  private getHashSessionId(): string {
    const value = location.hash.slice(1);
    return value === "settings" ? "" : value;
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
