import {
  createAgentSession, ModelRuntime, SessionManager, type AgentSession, type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt, AuthType } from "@earendil-works/pi-ai";
import type { Configuration } from "./config.ts";
import { SessionSummaryJob } from "./session-summary-job.ts";

export type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface SessionSummary {
  id: string;
  path: string;
  name?: string;
  firstMessage: string;
  modified: number;
}

export interface Snapshot {
  messages: AgentSession["messages"];
  isStreaming: boolean;
  queue: { steering: string[]; followUp: string[] };
  settings?: SessionSettings;
}

export interface ModelChoice {
  provider: string;
  id: string;
  name: string;
}

export interface SessionSettings {
  model?: ModelChoice;
  models: ModelChoice[];
  thinkingLevel: string;
  thinkingLevels: string[];
}

export interface ProviderSettings {
  id: string;
  name: string;
  authTypes: AuthType[];
  isConfigured: boolean;
  source?: string;
  accountLabel?: string;
}

export type ProviderLoginEvent = AuthEvent | { type: "prompt"; prompt: AuthPrompt }
  | { type: "complete" } | { type: "failed"; message: string };

interface PendingLogin {
  controller: AbortController;
  answer?: (value: string) => void;
}

export class PiSession {
  readonly session: AgentSession;
  private _isRunning = false;
  private isChangingModel = false;
  private readonly summaryJob: SessionSummaryJob;

  constructor(session: AgentSession, summaryDelay?: number) {
    this.session = session;
    this.summaryJob = new SessionSummaryJob(session, () => this.is_running || this.isChangingModel, summaryDelay);
  }

  get id(): string {
    return this.session.sessionId;
  }

  get is_running(): boolean {
    return this._isRunning;
  }

  get snapshot(): Snapshot {
    return {
      messages: [...this.session.messages],
      isStreaming: this.is_running || this.session.isStreaming,
      queue: { steering: [...this.session.getSteeringMessages()], followUp: [...this.session.getFollowUpMessages()] },
      settings: this.settings,
    };
  }

  async prompt(text: string): Promise<void> {
    if (this.isChangingModel) throw new Error("The model is changing. Try again when it finishes.");
    if (this.is_running) throw new Error("A run is already active.");
    this._isRunning = true;
    try {
      await this.session.prompt(text);
    } finally {
      this._isRunning = false;
      this.summaryJob.schedule();
    }
  }

  get settings(): SessionSettings {
    const describe = ({ provider, id, name }: ModelChoice): ModelChoice => ({ provider, id, name });
    return {
      model: this.session.model ? describe(this.session.model) : undefined,
      models: this.session.modelRuntime.getAvailableSnapshot().map(describe),
      thinkingLevel: this.session.thinkingLevel,
      thinkingLevels: this.session.getAvailableThinkingLevels(),
    };
  }

  async queue(text: string, mode: "steer" | "follow_up"): Promise<void> {
    if (!this.is_running) return this.prompt(text);
    if (mode === "steer") await this.session.steer(text);
    else await this.session.followUp(text);
  }

  async setModel(provider: string, id: string): Promise<void> {
    this.requireIdle();
    const model = this.session.modelRuntime.getAvailableSnapshot()
      .find((choice) => choice.provider === provider && choice.id === id);
    if (!model) throw new Error("Unknown or unavailable model.");
    this.isChangingModel = true;
    try {
      await this.session.setModel(model);
    } finally {
      this.isChangingModel = false;
    }
  }

  setThinkingLevel(level: string): void {
    this.requireIdle();
    const supported = this.session.getAvailableThinkingLevels().find((choice) => choice === level);
    if (!supported) throw new Error("Unsupported thinking level.");
    this.session.setThinkingLevel(supported);
  }

  private requireIdle(): void {
    if (this.is_running || this.isChangingModel) throw new Error("Change settings when the session is idle.");
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    return this.session.subscribe(listener);
  }

  async close(): Promise<void> {
    await this.summaryJob.close();
    await this.session.abort();
    this.session.dispose();
  }
}

export class PiAdapter {
  private readonly options: CreateAgentSessionOptions;
  private readonly sessionDirectory?: string;
  private readonly summaryDelay?: number;
  private readonly modelRuntime?: ModelRuntime;
  private readonly logins = new Map<string, PendingLogin>();

  constructor(options: CreateAgentSessionOptions = {}, sessionDirectory?: string, summaryDelay?: number) {
    this.options = options;
    this.modelRuntime = options.modelRuntime as ModelRuntime | undefined;
    this.sessionDirectory = sessionDirectory;
    this.summaryDelay = summaryDelay;
  }

  static async fromConfiguration(configuration: Configuration): Promise<PiAdapter> {
    const modelRuntime = await ModelRuntime.create();
    if (!configuration.model) return new PiAdapter({ modelRuntime });
    const { provider, id } = configuration.model;
    const model = modelRuntime.getModel(provider, id);
    if (!model) throw new Error(`Model not found: ${provider}/${id}`);
    return new PiAdapter({ modelRuntime, model });
  }

  async list(project: string): Promise<SessionSummary[]> {
    const sessions = await SessionManager.list(project, this.sessionDirectory);
    return sessions.map((info) => ({
      id: info.id, path: info.path, name: info.name, firstMessage: info.firstMessage, modified: info.modified.getTime(),
    }));
  }

  async getProviderSettings(): Promise<ProviderSettings[]> {
    const runtime = this.getModelRuntime();
    return runtime.getProviders().map((provider) => {
      const status = runtime.getProviderAuthStatus(provider.id);
      const authTypes: AuthType[] = [];
      if (provider.auth.apiKey?.login) authTypes.push("api_key");
      if (provider.auth.oauth) authTypes.push("oauth");
      return { id: provider.id, name: provider.name, authTypes, isConfigured: status.configured, source: status.label, accountLabel: provider.auth.oauth?.loginLabel };
    }).sort((first, second) => first.name.localeCompare(second.name));
  }

  async setProviderApiKey(provider: string, apiKey: string): Promise<void> {
    const runtime = this.getModelRuntime();
    const target = runtime.getProvider(provider);
    if (!target?.auth.apiKey?.login) throw new Error("This provider does not accept an API key.");
    await runtime.setRuntimeApiKey(provider, apiKey);
    await runtime.refresh({ providers: [provider], allowNetwork: false });
  }

  async logoutProvider(provider: string): Promise<void> {
    const runtime = this.getModelRuntime();
    if (!runtime.getProvider(provider)) throw new Error("Unknown provider.");
    await runtime.logout(provider);
    await runtime.refresh({ providers: [provider], allowNetwork: false });
  }

  startProviderLogin(provider: string, type: AuthType, notify: (event: ProviderLoginEvent) => void): string {
    const runtime = this.getModelRuntime();
    const target = runtime.getProvider(provider);
    if (!target || (type === "api_key" && !target.auth.apiKey?.login) || (type === "oauth" && !target.auth.oauth)) {
      throw new Error("This login method is not available.");
    }
    const loginId = randomUUID();
    const pending: PendingLogin = { controller: new AbortController() };
    this.logins.set(loginId, pending);
    void runtime.login(provider, type, {
      signal: pending.controller.signal,
      notify,
      prompt: (prompt) => this.requestLoginInput(loginId, pending, prompt, notify),
    }, { agentName: "pi remote" }).then(async () => {
      await runtime.refresh({ providers: [provider], allowNetwork: false });
      notify({ type: "complete" });
    }).catch((error: unknown) => {
      if (!pending.controller.signal.aborted) notify({ type: "failed", message: error instanceof Error ? error.message : "Login failed." });
    }).finally(() => this.logins.delete(loginId));
    return loginId;
  }

  submitProviderLogin(loginId: string, value: string): void {
    const login = this.logins.get(loginId);
    if (!login?.answer) throw new Error("This login is not waiting for input.");
    const answer = login.answer;
    login.answer = undefined;
    answer(value);
  }

  cancelProviderLogin(loginId: string): void {
    const login = this.logins.get(loginId);
    if (!login) throw new Error("Unknown login.");
    login.controller.abort();
  }

  create(project: string): Promise<PiSession> {
    return this.start(project, SessionManager.create(project, this.sessionDirectory));
  }

  open(project: string, path: string): Promise<PiSession> {
    return this.start(project, SessionManager.open(path, this.sessionDirectory, project));
  }

  private async start(project: string, sessionManager: SessionManager): Promise<PiSession> {
    const model = sessionManager.buildSessionContext().model ? undefined : this.options.model;
    const { session } = await createAgentSession({ ...this.options, model, cwd: project, sessionManager });
    try {
      await session.modelRuntime.getAvailable();
      return new PiSession(session, this.summaryDelay);
    } catch (error) {
      session.dispose();
      throw error;
    }
  }

  private getModelRuntime(): ModelRuntime {
    if (!this.modelRuntime) throw new Error("Provider settings are unavailable.");
    return this.modelRuntime;
  }

  private requestLoginInput(loginId: string, pending: PendingLogin, prompt: AuthPrompt,
    notify: (event: ProviderLoginEvent) => void): Promise<string> {
    notify({ type: "prompt", prompt });
    return new Promise((resolve, reject) => {
      pending.answer = resolve;
      const abort = () => reject(new Error("Login cancelled."));
      pending.controller.signal.addEventListener("abort", abort, { once: true });
    });
  }
}
