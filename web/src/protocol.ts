import {
  lastUserActivity,
  type DefaultModelSettings,
  type ModelChoice,
  type ProjectGroup,
  type ProviderLoginEvent,
  type ProviderSettings,
  type SessionEvent,
  type SessionInfo,
  type SessionListItem,
  type Snapshot,
} from "../../server/src/protocol.ts";

export type { ProjectGroup, SessionListItem as SessionItem } from "../../server/src/protocol.ts";

const projectHashPrefix = "#project:";

export function projectHash(path: string): string {
  return `${projectHashPrefix}${encodeURIComponent(path)}`;
}

export function projectPathFromHash(hash: string): string | undefined {
  if (!hash.startsWith(projectHashPrefix)) return undefined;
  try {
    return decodeURIComponent(hash.slice(projectHashPrefix.length));
  } catch {
    return undefined;
  }
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/** The session list reply, or an update the server pushes to every client. */
export interface SessionsMessage {
  type: "sessions";
  projects: ProjectGroup[];
  groupsRoot?: string;
  push?: boolean;
}

/** A live session event, in sequence after the snapshot's `seq`. */
export interface EventMessage {
  type: "event";
  sessionId: string;
  seq: number;
  event: SessionEvent;
}

/** A session's state, sent on subscribe and after a missed event forces a re-subscribe. */
export interface SnapshotMessage extends Snapshot {
  type: "snapshot";
  sessionId: string;
  runEvents: SessionEvent[];
  seq: number;
}

export type ServerMessage =
  | SessionsMessage
  | EventMessage
  | SnapshotMessage
  | { type: "error"; sessionId?: string; message: string }
  | { type: "session_created"; sessionId: string }
  | { type: "group_created"; project: string }
  | { type: "session_info"; sessionId: string; info: SessionInfo }
  | { type: "providers"; providers: ProviderSettings[] }
  | { type: "provider_key"; provider: string; apiKey: string }
  | ({ type: "default_model" } & DefaultModelSettings)
  | { type: "provider_login_started"; loginId: string }
  | { type: "provider_login_event"; loginId: string; event: ProviderLoginEvent }
  | { type: "push_key"; publicKey: string | null }
  | { type: "push_subscribed" | "push_unsubscribed" };

export function getProjectName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function getSessionTitle(session: SessionListItem): string {
  return session.name || session.firstMessage || "New session";
}

/**
 * Puts the project where the user last sent a message first, and each project's newest chat first.
 * Pass false to reverse both, so a phone shows that chat at the bottom.
 */
export function orderProjects(projects: ProjectGroup[], isNewestFirst: boolean): ProjectGroup[] {
  const ordered = projects
    .map((project) => ({
      path: project.path,
      sessions: [...project.sessions].sort((a, b) => lastUserActivity(b) - lastUserActivity(a)),
    }))
    .sort(
      (a, b) =>
        (b.sessions[0] ? lastUserActivity(b.sessions[0]) : 0) - (a.sessions[0] ? lastUserActivity(a.sessions[0]) : 0),
    );
  if (isNewestFirst) return ordered;
  return ordered.reverse().map((project) => ({ ...project, sessions: project.sessions.reverse() }));
}
