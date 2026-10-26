import {
  createAgentSession, ModelRuntime, SessionManager, type AgentSession, type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
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

  constructor(options: CreateAgentSessionOptions = {}, sessionDirectory?: string, summaryDelay?: number) {
    this.options = options;
    this.sessionDirectory = sessionDirectory;
    this.summaryDelay = summaryDelay;
  }

  static async fromConfiguration(configuration: Configuration): Promise<PiAdapter> {
    if (!configuration.model) return new PiAdapter();
    const modelRuntime = await ModelRuntime.create();
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
}
