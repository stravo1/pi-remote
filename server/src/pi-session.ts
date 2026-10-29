import { randomUUID } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { SessionSummaryJob } from "./session-summary-job.ts";
import type {
  CommandChoice,
  ModelChoice,
  PromptImage,
  QueuedMessage,
  SessionEvent,
  SessionInfo,
  SessionSettings,
  Snapshot,
} from "./protocol.ts";

function toImageContent(image: PromptImage): ImageContent {
  return { type: "image", data: image.data, mimeType: image.mimeType };
}

/**
 * pi keeps only the text of a queued message, so the server remembers the images and the id
 * beside it. A queued message pi knows and the server does not, such as one an extension added,
 * gets an entry without images.
 */
function alignQueue(entries: QueuedMessage[], texts: readonly string[]): QueuedMessage[] {
  const remaining = new Map<string, QueuedMessage[]>();
  for (const entry of entries) {
    const bucket = remaining.get(entry.text);
    if (bucket) bucket.push(entry);
    else remaining.set(entry.text, [entry]);
  }
  return texts.map((text) => remaining.get(text)?.shift() ?? { id: randomUUID(), text, images: [] });
}

/**
 * Extensions clean up on `session_shutdown`; `dispose()` alone does not emit it. The MCP
 * extension closes its stdio servers here, so they die with the session.
 */
export async function shutdownExtensions(session: AgentSession): Promise<void> {
  try {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  } catch (error) {
    console.error("Session shutdown handlers failed", error);
  }
}

export function describeModel(model: { provider: string; id: string; name: string; input: string[] }): ModelChoice {
  return { provider: model.provider, id: model.id, name: model.name, hasImageInput: model.input.includes("image") };
}

// pi queues already-expanded text. These add it back without running input handlers again.
interface QueueInternals {
  _queueSteer(text: string, images?: ImageContent[]): Promise<void>;
  _queueFollowUp(text: string, images?: ImageContent[]): Promise<void>;
}

export class PiSession {
  readonly session: AgentSession;
  private _isRunning = false;
  private isChanging = false;
  private readonly summaryJob: SessionSummaryJob;
  private queued: { steering: QueuedMessage[]; followUp: QueuedMessage[] } = { steering: [], followUp: [] };
  // Rebuilding the queue clears and re-adds every message. During that pass the recorded queue is
  // already the final one, so pi's intermediate updates must not sync it back down.
  private isRebuilding = false;

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
      queue: this.syncQueue(),
      settings: this.settings,
    };
  }

  private syncQueue(): { steering: QueuedMessage[]; followUp: QueuedMessage[] } {
    if (!this.isRebuilding) {
      this.queued.steering = alignQueue(this.queued.steering, this.session.getSteeringMessages());
      this.queued.followUp = alignQueue(this.queued.followUp, this.session.getFollowUpMessages());
    }
    return { steering: [...this.queued.steering], followUp: [...this.queued.followUp] };
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

  async queue(text: string, mode: "steer" | "follow_up", images: PromptImage[] = []): Promise<void> {
    if (!this.is_running) return this.prompt(text, images);
    const entry: QueuedMessage = { id: randomUUID(), text, images };
    const key = mode === "steer" ? "steering" : "followUp";
    // Record the images before pi emits its queue update, so that update already carries them.
    this.queued[key].push(entry);
    const forget = () => {
      this.queued[key] = this.queued[key].filter((queued) => queued !== entry);
    };
    try {
      const contents = images.map(toImageContent);
      const disposition =
        mode === "steer" ? await this.session.steer(text, contents) : await this.session.followUp(text, contents);
      // A handled input ran at once instead of queueing, so forget it again.
      if (disposition !== "queued") forget();
    } catch (error) {
      forget();
      throw error;
    }
  }

  steerFollowUp(id: string): void {
    this.syncQueue();
    if (!this.is_running || !this.queued.followUp.some((entry) => entry.id === id))
      throw new Error("This message is no longer queued.");
    // Clearing the queue emits its own queue update, so hold the recorded queue before it runs.
    this.isRebuilding = true;
    try {
      const { steering, followUp } = this.session.clearQueue();
      const followUps = alignQueue(this.queued.followUp, followUp);
      const promoted = followUps.find((entry) => entry.id === id);
      if (!promoted) throw new Error("This message is no longer queued.");
      // The promoted message joins the steering queue at its end, as pi's own Send now does.
      this.queued = {
        steering: [...alignQueue(this.queued.steering, steering), promoted],
        followUp: followUps.filter((entry) => entry !== promoted),
      };
      const queue = this.session as unknown as QueueInternals;
      for (const entry of this.queued.steering) void queue._queueSteer(entry.text, entry.images.map(toImageContent));
      for (const entry of this.queued.followUp) void queue._queueFollowUp(entry.text, entry.images.map(toImageContent));
    } finally {
      this.isRebuilding = false;
    }
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

  subscribe(listener: (event: SessionEvent) => void): () => void {
    return this.session.subscribe((event) => {
      // The client shows queued images, so the queue event carries the server's copy.
      if (event.type === "queue_update") listener({ type: "queue_update", ...this.syncQueue() });
      else listener(event);
    });
  }

  async close(): Promise<void> {
    await this.summaryJob.close();
    await this.session.abort();
    await shutdownExtensions(this.session);
    this.session.dispose();
  }
}
