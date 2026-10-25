import {
  createAgentSession, ModelRuntime, type AgentSession, type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import type { Configuration } from "./config.ts";

export type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export class PiAdapter {
  readonly session: AgentSession;
  private _isRunning = false;

  constructor(session: AgentSession) {
    this.session = session;
  }

  static async open(cwd: string, options: CreateAgentSessionOptions = {}): Promise<PiAdapter> {
    const { session } = await createAgentSession({ ...options, cwd });
    return new PiAdapter(session);
  }

  static async fromConfiguration(configuration: Configuration): Promise<PiAdapter> {
    if (!configuration.model) return PiAdapter.open(configuration.projects[0]);
    const modelRuntime = await ModelRuntime.create();
    const { provider, id } = configuration.model;
    const model = modelRuntime.getModel(provider, id);
    if (!model) throw new Error(`Model not found: ${provider}/${id}`);
    return PiAdapter.open(configuration.projects[0], { modelRuntime, model });
  }

  get id(): string {
    return this.session.sessionId;
  }

  get is_running(): boolean {
    return this._isRunning;
  }

  async prompt(text: string): Promise<void> {
    if (this.is_running) throw new Error("A run is already active.");
    this._isRunning = true;
    try {
      await this.session.prompt(text);
    } finally {
      this._isRunning = false;
    }
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    return this.session.subscribe(listener);
  }

  async close(): Promise<void> {
    await this.session.abort();
    this.session.dispose();
  }
}
