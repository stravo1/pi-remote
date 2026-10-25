import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { Configuration } from "./config.ts";
import { serveHttp } from "./http.ts";
import type { HubClient, SessionHub } from "./session-hub.ts";

interface Command {
  type?: unknown;
  sessionId?: unknown;
  project?: unknown;
  name?: unknown;
  text?: unknown;
}

export class Transport {
  readonly server;
  readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  readonly hub: SessionHub;
  readonly configuration: Configuration;
  readonly heartbeat: ReturnType<typeof setInterval>;
  readonly alive = new Map<WebSocket, boolean>();

  constructor(hub: SessionHub, configuration: Configuration, webDirectory: string, pingInterval = 30_000) {
    this.hub = hub;
    this.configuration = configuration;
    this.server = createServer((request, response) => {
      void serveHttp(request, response, webDirectory).catch((error: unknown) => {
        const status = error instanceof URIError ? 400 : 500;
        response.writeHead(status).end();
      });
    });
    this.server.on("upgrade", (request, socket, head) => this.upgrade(request, socket, head));
    this.sockets.on("connection", (socket) => this.connect(socket));
    this.heartbeat = setInterval(() => this.ping(), pingInterval);
    this.heartbeat.unref();
  }

  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on("error", () => socket.destroy());
    if (request.headers.origin !== this.configuration.origin
      || request.headers["remote-user"] !== this.configuration.allowedUser) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (request.url !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    this.sockets.handleUpgrade(request, socket, head, (client) => this.sockets.emit("connection", client));
  }

  connect(socket: WebSocket): void {
    const client: HubClient = { send: (message) => { if (socket.readyState === WebSocket.OPEN) socket.send(message); } };
    this.alive.set(socket, true);
    socket.on("pong", () => this.alive.set(socket, true));
    socket.on("close", () => {
      this.alive.delete(socket);
      this.hub.removeClient(client);
    });
    socket.on("error", () => socket.terminate());
    socket.on("message", (data, isBinary) => {
      void this.command(client, data, isBinary).catch((error: unknown) => {
        client.send(JSON.stringify({
          type: "error", sessionId: sessionIdOf(data),
          message: error instanceof Error ? error.message : "The command failed.",
        }));
      });
    });
  }

  async command(client: HubClient, data: RawData, isBinary: boolean): Promise<void> {
    if (isBinary) throw new Error("Send a JSON text message.");
    const command: Command = JSON.parse(data.toString());
    switch (command?.type) {
      case "list_sessions": return client.send(JSON.stringify(await this.hub.getSessionList()));
      case "new_session": return this.createSession(client, command);
      case "new_group": return this.createGroup(client, command);
      case "subscribe": return this.hub.subscribe(client, requireSessionId(command));
      case "unsubscribe": return this.hub.unsubscribe(client, requireSessionId(command));
      case "prompt": return this.hub.prompt(requireSessionId(command), requireText(command));
      case "abort": return this.hub.abort(requireSessionId(command));
      default: throw new Error("Unknown command.");
    }
  }

  async createGroup(client: HubClient, command: Command): Promise<void> {
    if (typeof command.name !== "string") throw new Error("The group name must be a string.");
    const project = await this.hub.createGroup(command.name);
    client.send(JSON.stringify({ type: "group_created", project }));
  }

  async createSession(client: HubClient, command: Command): Promise<void> {
    if (typeof command.project !== "string") throw new Error("The project must be a string.");
    const sessionId = await this.hub.createSession(command.project);
    client.send(JSON.stringify({ type: "session_created", sessionId }));
  }

  ping(): void {
    for (const [socket, isAlive] of this.alive) {
      if (!isAlive) {
        socket.terminate();
        continue;
      }
      this.alive.set(socket, false);
      socket.ping();
    }
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const socket of this.sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
    if (this.server.listening) await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function requireSessionId(command: Command): string {
  if (typeof command.sessionId !== "string" || !command.sessionId) throw new Error("The sessionId must be a nonempty string.");
  return command.sessionId;
}

function requireText(command: Command): string {
  if (typeof command.text !== "string" || !command.text.trim()) throw new Error("The prompt text must be a nonempty string.");
  return command.text;
}

function sessionIdOf(data: RawData): string | undefined {
  try {
    const { sessionId } = JSON.parse(data.toString());
    return typeof sessionId === "string" ? sessionId : undefined;
  } catch {
    return undefined;
  }
}
