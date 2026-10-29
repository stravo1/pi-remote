import type { AgentSession, AgentSessionEvent, SessionStats } from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthPrompt, AuthType } from "@earendil-works/pi-ai";

export type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

/** An image attached to a prompt, base64 without the data URL prefix. */
export interface PromptImage {
  data: string;
  mimeType: string;
}

/**
 * A message waiting for the run to reach it. pi keeps only its text, so the server tracks the images
 * and an id that the client uses to send it now.
 */
export interface QueuedMessage {
  id: string;
  text: string;
  images: PromptImage[];
}

/**
 * A session event as the client sees it. pi's events travel unchanged, except `queue_update`,
 * which carries the images and ids the server keeps for queued messages.
 */
export type SessionEvent =
  | Exclude<AgentSessionEvent, { type: "queue_update" }>
  | { type: "queue_update"; steering: QueuedMessage[]; followUp: QueuedMessage[] };

export interface Snapshot {
  messages: AgentSession["messages"];
  isStreaming: boolean;
  isCompacting: boolean;
  queue: { steering: QueuedMessage[]; followUp: QueuedMessage[] };
  settings?: SessionSettings;
}

export type SessionInfo = Omit<SessionStats, "sessionFile">;

export interface ModelChoice {
  provider: string;
  id: string;
  name: string;
  /** The model accepts images in prompts, so the client can show the attach button. */
  hasImageInput?: boolean;
}

export interface CommandChoice {
  name: string;
  description?: string;
  argumentHint?: string;
}

export interface SessionSettings {
  model?: ModelChoice;
  models: ModelChoice[];
  thinkingLevel: string;
  thinkingLevels: string[];
  commands: CommandChoice[];
}

export interface ProviderSettings {
  id: string;
  name: string;
  authTypes: AuthType[];
  isConfigured: boolean;
  isUsingApiKey: boolean;
  /** pi saved this login, so signing out can remove it. Keys from models.json or the environment cannot. */
  hasStoredLogin: boolean;
  source?: string;
  accountLabel?: string;
}

/** The stored default model plus the models of the active providers, for the settings picker. */
export interface DefaultModelSettings {
  models: ModelChoice[];
  /** The stored default model, when it is still available on an active provider. */
  model?: ModelChoice;
}

export type ProviderLoginEvent =
  AuthEvent | { type: "prompt"; prompt: AuthPrompt } | { type: "complete" } | { type: "failed"; message: string };

/** One session row in the session list. */
export interface SessionListItem {
  id: string;
  name?: string;
  firstMessage: string;
  modified: number;
  /** When the user last sent a message. Ordering uses this so a running reply does not move a chat. */
  lastUserMessage?: number;
  isRunning: boolean;
}

/** A project folder and its sessions, as the session list carries them. */
export interface ProjectGroup {
  path: string;
  sessions: SessionListItem[];
}

/** A running reply changes modified, so the list follows the last message the user sent. */
export function lastUserActivity(summary: Pick<SessionListItem, "modified" | "lastUserMessage">): number {
  return summary.lastUserMessage ?? summary.modified;
}
