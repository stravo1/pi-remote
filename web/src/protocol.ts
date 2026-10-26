export interface SessionItem {
  id: string;
  name?: string;
  firstMessage: string;
  modified: number;
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
