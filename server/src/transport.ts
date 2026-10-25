import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { Configuration } from "./config.ts";
import { serveHttp } from "./http.ts";
import type { AgentSessionEvent, PiAdapter } from "./pi-adapter.ts";

export interface RunMetrics {
  type: "run";
  sessionId: string;
  eventCount: number;
  bytes: number;
}

export class Transport {
  readonly server;
  readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  readonly adapter: Pick<PiAdapter, "id" | "prompt" | "subscribe">;
  readonly configuration: Configuration;
  readonly logRun: (metrics: RunMetrics) => void;
  readonly heartbeat: ReturnType<typeof setInterval>;
  readonly unsubscribe: () => void;
  readonly alive = new Map<WebSocket, boolean>();
  sequence = 0;
  eventCount = 0;
  bytes = 0;

  constructor(
    adapter: Pick<PiAdapter, "id" | "prompt" | "subscribe">,
    configuration: Configuration,
    webDirectory: string,
    pingInterval = 30_000,
    logRun: (metrics: RunMetrics) => void = (metrics) => console.log(JSON.stringify(metrics)),
  ) {
    this.adapter = adapter;
    this.configuration = configuration;
    this.logRun = logRun;
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
    this.unsubscribe = adapter.subscribe((event) => this.broadcast(event));
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
    this.alive.set(socket, true);
    socket.on("pong", () => this.alive.set(socket, true));
    socket.on("close", () => this.alive.delete(socket));
    socket.on("error", () => socket.terminate());
    socket.on("message", (data, isBinary) => {
      void this.command(data, isBinary).catch((error: unknown) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
          type: "error", sessionId: this.adapter.id,
          message: error instanceof Error ? error.message : "The command failed.",
        }));
      });
    });
  }

  async command(data: RawData, isBinary: boolean): Promise<void> {
    if (isBinary) throw new Error("Send a JSON text message.");
    const command = JSON.parse(data.toString());
    if (!isPrompt(command)) {
      throw new Error("Unknown command. Expected prompt.");
    }
    if (command.sessionId !== undefined && command.sessionId !== this.adapter.id) {
      throw new Error("Unknown session.");
    }
    if (typeof command.text !== "string" || !command.text.trim()) {
      throw new Error("The prompt text must be a nonempty string.");
    }
    await this.adapter.prompt(command.text);
  }

  broadcast(event: AgentSessionEvent): void {
    if (event.type === "agent_start") {
      this.eventCount = 0;
      this.bytes = 0;
    }
    const message = JSON.stringify({ type: "event", sessionId: this.adapter.id, seq: ++this.sequence, event });
    this.eventCount++;
    for (const socket of this.sockets.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(message);
      this.bytes += Buffer.byteLength(message);
    }
    if (event.type === "agent_settled") {
      this.logRun({ type: "run", sessionId: this.adapter.id, eventCount: this.eventCount, bytes: this.bytes });
    }
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
    this.unsubscribe();
    for (const socket of this.sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
    if (this.server.listening) await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function isPrompt(value: unknown): value is { type: "prompt"; text?: unknown; sessionId?: unknown } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "prompt";
}
