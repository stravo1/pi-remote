import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type LoadedMcpConfig,
  type McpExtensionOptions,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { AuthEvent, AuthPrompt, AuthType } from "@earendil-works/pi-ai";
import { SessionActivity } from "./session-activity.ts";
import { SessionSummaryJob } from "./session-summary-job.ts";
import type {
  CommandChoice,
  DefaultModelSettings,
  ModelChoice,
  PromptImage,
  ProviderLoginEvent,
  ProviderSettings,
  SessionInfo,
  SessionSettings,
  Snapshot,
} from "./protocol.ts";

export type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

function toImageContent(image: PromptImage): { type: "image"; data: string; mimeType: string } {
  return { type: "image", data: image.data, mimeType: image.mimeType };
}

/**
 * Extensions clean up on `session_shutdown`; `dispose()` alone does not emit it. The MCP
 * extension closes its stdio servers here, so they die with the session.
 */
async function shutdownExtensions(session: AgentSession): Promise<void> {
  try {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  } catch (error) {
    console.error("Session shutdown handlers failed", error);
  }
}

/**
 * Sessions that opt out of the user's agent directory (tests and sandboxes set `agentDir`)
 * start with an empty MCP server list. The extension reads its own configuration with
 * `getAgentDir()`, so without this it would connect the user's real servers in tests.
 */
function emptyMcpConfig(): LoadedMcpConfig {
  return { servers: [], errors: [] };
}

export interface SessionSummary {
  id: string;
  path: string;
  name?: string;
  firstMessage: string;
  modified: number;
  lastUserMessage?: number;
}

function describeModel(model: { provider: string; id: string; name: string; input: string[] }): ModelChoice {
  return { provider: model.provider, id: model.id, name: model.name, hasImageInput: model.input.includes("image") };
}

// pi queues already-expanded text. These add it back without running input handlers again.
interface QueueInternals {
  _queueSteer(text: string): Promise<void>;
  _queueFollowUp(text: string): Promise<void>;
}

interface PendingLogin {
  controller: AbortController;
  answer?: (value: string) => void;
  settled?: Promise<void>;
}

export class PiSession {
  readonly session: AgentSession;
  private _isRunning = false;
  private isChanging = false;
  private readonly summaryJob: SessionSummaryJob;

  constructor(session: AgentSession, summaryDelay?: number, summaryInterval?: number) {
    this.session = session;
    this.summaryJob = new SessionSummaryJob(
      session,
      () => this.is_running || this.isChanging,
      summaryDelay,
      summaryInterval,
    );
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
      isCompacting: this.session.isCompacting,
      queue: { steering: [...this.session.getSteeringMessages()], followUp: [...this.session.getFollowUpMessages()] },
      settings: this.settings,
    };
  }

  async prompt(text: string, images: PromptImage[] = []): Promise<void> {
    if (this.isChanging) throw new Error("The session is changing. Try again when it finishes.");
    if (this.is_running) throw new Error("A run is already active.");
    this._isRunning = true;
    try {
      await this.session.prompt(text, images.length ? { images: images.map(toImageContent) } : undefined);
    } finally {
      this._isRunning = false;
      this.summaryJob.schedule();
    }
  }

  get settings(): SessionSettings {
    return {
      model: this.session.model ? describeModel(this.session.model) : undefined,
      models: this.session.modelRuntime.getAvailableSnapshot().map(describeModel),
      thinkingLevel: this.session.thinkingLevel,
      thinkingLevels: this.session.getAvailableThinkingLevels(),
      commands: this.commands,
    };
  }

  // The same commands pi's terminal app offers: extension commands, prompt templates, and skills.
  get commands(): CommandChoice[] {
    const extensions = this.session.extensionRunner
      .getRegisteredCommands()
      // /mcp runs an interactive server manager (menus, OAuth sign-in) that needs a UI
      // bridge pi remote does not offer yet. Hide it until that exists.
      .filter(({ invocationName }) => invocationName !== "mcp")
      .map(({ invocationName, description }) => ({ name: invocationName, description }));
    const templates = this.session.promptTemplates.map(({ name, description, argumentHint }) => ({
      name,
      description,
      argumentHint,
    }));
    const skills = this.session.resourceLoader
      .getSkills()
      .skills.map(({ name, description }) => ({ name: `skill:${name}`, description }));
    return [...extensions, ...templates, ...skills];
  }

  async queue(text: string, mode: "steer" | "follow_up"): Promise<void> {
    if (!this.is_running) return this.prompt(text);
    if (mode === "steer") await this.session.steer(text);
    else await this.session.followUp(text);
  }

  steerFollowUp(text: string): void {
    const index = this.session.getFollowUpMessages().indexOf(text);
    if (!this.is_running || index === -1) throw new Error("This message is no longer queued.");
    const { steering, followUp } = this.session.clearQueue();
    followUp.splice(index, 1);
    const queue = this.session as unknown as QueueInternals;
    for (const message of [...steering, text]) void queue._queueSteer(message);
    for (const message of followUp) void queue._queueFollowUp(message);
  }

  async setModel(provider: string, id: string): Promise<void> {
    this.requireIdle();
    const model = this.session.modelRuntime
      .getAvailableSnapshot()
      .find((choice) => choice.provider === provider && choice.id === id);
    if (!model) throw new Error("Unknown or unavailable model.");
    await this.change(() => this.session.setModel(model));
  }

  get name(): string | undefined {
    return this.session.sessionName;
  }

  rename(name: string): void {
    this.summaryJob.rename(name);
  }

  get info(): SessionInfo {
    const { sessionFile: _, ...info } = this.session.getSessionStats();
    return info;
  }

  async compact(instructions?: string): Promise<void> {
    this.requireIdle();
    await this.change(() => this.session.compact(instructions?.trim() || undefined));
  }

  private async change(task: () => Promise<unknown>): Promise<void> {
    this.isChanging = true;
    try {
      await task();
    } finally {
      this.isChanging = false;
    }
  }

  setThinkingLevel(level: string): void {
    this.requireIdle();
    const supported = this.session.getAvailableThinkingLevels().find((choice) => choice === level);
    if (!supported) throw new Error("Unsupported thinking level.");
    this.session.setThinkingLevel(supported);
  }

  private requireIdle(): void {
    if (this.is_running || this.isChanging) throw new Error("Change settings when the session is idle.");
  }

  async abort(): Promise<void> {
    this.session.abortCompaction();
    await this.session.abort();
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    return this.session.subscribe(listener);
  }

  async close(): Promise<void> {
    await this.summaryJob.close();
    await this.session.abort();
    await shutdownExtensions(this.session);
    this.session.dispose();
  }
}

export class PiAdapter {
  private readonly options: CreateAgentSessionOptions;
  private readonly sessionDirectory?: string;
  private readonly summaryDelay?: number;
  private readonly summaryInterval?: number;
  private readonly mcpOptions?: McpExtensionOptions;
  private readonly modelRuntime?: ModelRuntime;
  private readonly activity = new SessionActivity();
  private readonly logins = new Map<string, PendingLogin>();
  private settingsManager?: SettingsManager;

  constructor(
    options: CreateAgentSessionOptions = {},
    sessionDirectory?: string,
    summaryDelay?: number,
    summaryInterval?: number,
    // Overrides the MCP extension wiring, for tests that inject a fake server.
    mcpOptions?: McpExtensionOptions,
  ) {
    this.options = options;
    this.modelRuntime = options.modelRuntime as ModelRuntime | undefined;
    this.sessionDirectory = sessionDirectory;
    this.summaryDelay = summaryDelay;
    this.summaryInterval = summaryInterval;
    this.mcpOptions = mcpOptions;
  }

  async list(project: string): Promise<SessionSummary[]> {
    const sessions = await SessionManager.list(project, this.sessionDirectory);
    return Promise.all(
      sessions.map(async (info) => ({
        id: info.id,
        path: info.path,
        name: info.name,
        firstMessage: info.firstMessage,
        modified: info.modified.getTime(),
        lastUserMessage: await this.activity.lastUserMessage(info.path),
      })),
    );
  }

  async delete(project: string, sessionId: string): Promise<void> {
    const session = (await SessionManager.list(project, this.sessionDirectory)).find((info) => info.id === sessionId);
    if (!session) throw new Error("Unknown session.");
    await rm(session.path);
  }

  async getProviderSettings(): Promise<ProviderSettings[]> {
    const runtime = this.getModelRuntime();
    return runtime
      .getProviders()
      .map((provider) => {
        const status = runtime.getProviderAuthStatus(provider.id);
        const authTypes: AuthType[] = [];
        if (provider.auth.apiKey?.login) authTypes.push("api_key");
        if (provider.auth.oauth) authTypes.push("oauth");
        return {
          id: provider.id,
          name: provider.name,
          authTypes,
          isConfigured: status.configured,
          isUsingApiKey: status.configured && !runtime.isUsingOAuth(provider.id),
          hasStoredLogin: status.source === "stored" || status.source === "runtime",
          source: status.label,
          accountLabel: provider.auth.oauth?.loginLabel,
        };
      })
      .sort((first, second) => first.name.localeCompare(second.name));
  }

  async setProviderApiKey(provider: string, apiKey: string): Promise<void> {
    const runtime = this.getModelRuntime();
    const target = runtime.getProvider(provider);
    if (!target?.auth.apiKey?.login) throw new Error("This provider does not accept an API key.");
    let isAnswered = false;
    await runtime.login(provider, "api_key", {
      notify: () => undefined,
      prompt: async (prompt) => {
        if (isAnswered || prompt.type !== "secret")
          throw new Error("This provider needs more than a key. Add it again from Add provider.");
        isAnswered = true;
        return apiKey;
      },
    });
    await runtime.removeRuntimeApiKey(provider);
    await runtime.refresh({ providers: [provider], allowNetwork: false });
  }

  async getProviderApiKey(provider: string): Promise<string> {
    const runtime = this.getModelRuntime();
    if (runtime.isUsingOAuth(provider)) throw new Error("This provider does not use an API key.");
    return (await runtime.getAuth(provider))?.auth.apiKey ?? "";
  }

  async logoutProvider(provider: string): Promise<void> {
    const runtime = this.getModelRuntime();
    if (!runtime.getProvider(provider)) throw new Error("Unknown provider.");
    const { source } = runtime.getProviderAuthStatus(provider);
    if (source !== "stored" && source !== "runtime") {
      throw new Error("This provider is set up in models.json or the environment. Remove it there.");
    }
    await runtime.logout(provider);
    await runtime.refresh({ providers: [provider], allowNetwork: false });
    await this.clearDefaultModelFor(provider);
  }

  /** The default model for new sessions, with the models of the active providers for the picker. */
  getDefaultModel(): DefaultModelSettings {
    const models = this.getModelRuntime().getAvailableSnapshot().map(describeModel);
    const settings = this.getSettingsManager();
    const provider = settings.getDefaultProvider();
    const id = settings.getDefaultModel();
    const model =
      provider && id ? models.find((choice) => choice.provider === provider && choice.id === id) : undefined;
    return model ? { models, model } : { models };
  }

  /** Stores the default model for new sessions. An empty provider clears it, so sessions pick automatically. */
  async setDefaultModel(provider: string, id: string): Promise<void> {
    if (provider) {
      const available = this.getModelRuntime().getAvailableSnapshot();
      if (!available.some((model) => model.provider === provider && model.id === id)) {
        throw new Error("Unknown or unavailable model.");
      }
    }
    this.saveDefaultModel(provider || undefined, id || undefined);
    await this.getSettingsManager().flush();
  }

  /** Writes the default model to pi's global settings. Assigning undefined clears the stored choice. */
  private saveDefaultModel(provider: string | undefined, id: string | undefined): void {
    this.getSettingsManager().setDefaultModelAndProvider(provider as string, id as string);
  }

  /** A removed provider clears its stored default model, so new sessions pick automatically again. */
  private async clearDefaultModelFor(provider: string): Promise<void> {
    const settings = this.getSettingsManager();
    if (settings.getDefaultProvider() !== provider) return;
    this.saveDefaultModel(undefined, undefined);
    await settings.flush();
  }

  startProviderLogin(provider: string, type: AuthType, notify: (event: ProviderLoginEvent) => void): string {
    const runtime = this.getModelRuntime();
    const target = runtime.getProvider(provider);
    if (!target || (type === "api_key" && !target.auth.apiKey?.login) || (type === "oauth" && !target.auth.oauth)) {
      throw new Error("This login method is not available.");
    }
    const loginId = randomUUID();
    const pending: PendingLogin = { controller: new AbortController() };
    const previous = [...this.logins.values()];
    for (const login of previous) login.controller.abort();
    this.logins.set(loginId, pending);
    pending.settled = Promise.allSettled(previous.map((login) => login.settled))
      .then(() =>
        runtime.login(
          provider,
          type,
          {
            signal: pending.controller.signal,
            notify,
            prompt: (prompt) => this.requestLoginInput(loginId, pending, prompt, notify),
          },
          { agentName: "pi remote", getDeviceId: () => this.getSettingsManager().getOrCreateDeviceId() },
        ),
      )
      .then(async () => {
        await runtime.refresh({ providers: [provider], allowNetwork: false });
        notify({ type: "complete" });
      })
      .catch((error: unknown) => {
        if (!pending.controller.signal.aborted)
          notify({ type: "failed", message: error instanceof Error ? error.message : "Login failed." });
      })
      .finally(() => this.logins.delete(loginId));
    return loginId;
  }

  submitProviderLogin(loginId: string, value: string): void {
    const login = this.logins.get(loginId);
    if (!login?.answer) throw new Error("This login is not waiting for input.");
    const answer = login.answer;
    login.answer = undefined;
    answer(value);
  }

  cancelProviderLogins(): Promise<unknown> {
    const pending = [...this.logins.values()];
    for (const login of pending) login.controller.abort();
    return Promise.allSettled(pending.map((login) => login.settled));
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
    const model = sessionManager.buildSessionContext().model ? undefined : this.resolveDefaultModel();
    // The session manager must be the one the resource loader used, or settings overrides
    // (`defaultTools`, `defaultProvider`) do not reach the loadout.
    const settingsManager = SettingsManager.create(project, this.options.agentDir);
    const { session } = await createAgentSession({
      ...this.options,
      resourceLoader: this.options.resourceLoader ?? (await this.createResourceLoader(project, settingsManager)),
      settingsManager,
      model,
      cwd: project,
      sessionManager,
    });
    try {
      // Fires `session_start`, which connects the MCP servers and binds extension tools and
      // commands. Sessions created without client bindings use pi's default print-mode UI,
      // where `ctx.ui` notifications are no-ops.
      await session.bindExtensions({});
      await session.modelRuntime.getAvailable();
      return new PiSession(session, this.summaryDelay, this.summaryInterval);
    } catch (error) {
      await shutdownExtensions(session);
      session.dispose();
      throw error;
    }
  }

  /**
   * Loads the codemode, tool_search, and MCP extensions that pi's CLI loads and SDK sessions
   * leave out. MCP servers come from `~/.pi/agent/mcp.json` and the project's `.pi/mcp.json`.
   */
  private async createResourceLoader(
    project: string,
    settingsManager: SettingsManager,
  ): Promise<DefaultResourceLoader> {
    const agentDir = this.options.agentDir ?? getAgentDir();
    const loader = new DefaultResourceLoader({
      cwd: project,
      agentDir,
      settingsManager,
      extensionFactories: [
        createCodemodeExtension(),
        createToolSearchExtension(),
        createMcpExtension({
          ...(this.options.agentDir ? { loadConfig: emptyMcpConfig } : {}),
          ...this.mcpOptions,
        }),
      ],
    });
    await loader.reload();
    return loader;
  }

  /** New sessions use the stored default model, then an explicitly provided model, then pi's automatic pick. */
  private resolveDefaultModel(): CreateAgentSessionOptions["model"] {
    const runtime = this.modelRuntime;
    if (!runtime) return this.options.model;
    const settings = this.getSettingsManager();
    const provider = settings.getDefaultProvider();
    const id = settings.getDefaultModel();
    if (provider && id) {
      const stored = runtime.getModel(provider, id);
      if (stored && runtime.hasConfiguredAuth(provider)) return stored;
    }
    return this.options.model;
  }

  private getSettingsManager(): SettingsManager {
    this.settingsManager ??= SettingsManager.create(process.cwd(), this.options.agentDir);
    return this.settingsManager;
  }

  private getModelRuntime(): ModelRuntime {
    if (!this.modelRuntime) throw new Error("Provider settings are unavailable.");
    return this.modelRuntime;
  }

  private requestLoginInput(
    loginId: string,
    pending: PendingLogin,
    prompt: AuthPrompt,
    notify: (event: ProviderLoginEvent) => void,
  ): Promise<string> {
    notify({ type: "prompt", prompt });
    return new Promise((resolve, reject) => {
      pending.answer = resolve;
      const abort = () => reject(new Error("Login cancelled."));
      pending.controller.signal.addEventListener("abort", abort, { once: true });
    });
  }
}
