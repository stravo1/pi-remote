import type { ConnectionStatus } from "./protocol.ts";

// Shown when a command cannot go out because the socket is closed.
export const NOT_CONNECTED_MESSAGE = "Not connected. Reconnecting.";

export interface ConnectionHandlers {
  onStatus(status: ConnectionStatus): void;
  onOpen(): void;
  onMessage(message: any): void;
}

export interface ConnectionEnvironment {
  createSocket(): WebSocket;
  isLoginValid(): Promise<boolean>;
  reload(): void;
  schedule(callback: () => void, delay: number): unknown;
}

export function getBackoffDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 10_000);
}

export function getBrowserEnvironment(): ConnectionEnvironment {
  return {
    createSocket() {
      const url = new URL("/ws", window.location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url);
    },
    async isLoginValid() {
      try {
        const response = await fetch("/api/ping", { redirect: "manual", cache: "no-store" });
        return response.type !== "opaqueredirect" && response.status !== 401 && response.status !== 403;
      } catch {
        return true;
      }
    },
    reload: () => location.reload(),
    schedule: (callback, delay) => setTimeout(callback, delay),
  };
}

export class Connection {
  private readonly handlers: ConnectionHandlers;
  private readonly environment: ConnectionEnvironment;
  private socket?: WebSocket;
  private attempt = 0;
  private isReconnectPending = false;

  constructor(handlers: ConnectionHandlers, environment: ConnectionEnvironment = getBrowserEnvironment()) {
    this.handlers = handlers;
    this.environment = environment;
  }

  get is_open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.isReconnectPending = false;
    this.handlers.onStatus("connecting");
    const socket = this.environment.createSocket();
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus("connected");
      this.handlers.onOpen();
    };
    socket.onmessage = ({ data }) => this.handlers.onMessage(JSON.parse(data));
    socket.onclose = () => void this.handleClose(socket);
  }

  send(command: object): void {
    if (!this.is_open) throw new Error(NOT_CONNECTED_MESSAGE);
    this.socket!.send(JSON.stringify(command));
  }

  reconnectNow(): void {
    if (this.is_open || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.connect();
  }

  private async handleClose(socket: WebSocket): Promise<void> {
    if (socket !== this.socket || this.isReconnectPending) return;
    this.isReconnectPending = true;
    this.handlers.onStatus("disconnected");
    if (!(await this.environment.isLoginValid())) return this.environment.reload();
    this.environment.schedule(() => {
      if (this.isReconnectPending) this.connect();
    }, getBackoffDelay(this.attempt++));
  }
}
