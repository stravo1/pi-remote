export interface SessionItem {
  id: string;
  name?: string;
  firstMessage: string;
  modified: number;
  /** When the user last sent a message. Ordering uses this so a running reply does not move a chat. */
  lastUserMessage?: number;
  isRunning: boolean;
}

export interface ProjectGroup {
  path: string;
  sessions: SessionItem[];
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function getProjectName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function getSessionTitle(session: SessionItem): string {
  return session.name || session.firstMessage || "New session";
}

function lastUserActivity(session: SessionItem): number {
  return session.lastUserMessage ?? session.modified;
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
