import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { Configuration } from "./config.ts";
import { serveHttp } from "./http.ts";
import type { HubClient, SessionHub } from "./session-hub.ts";
import type { PiAdapter } from "./pi-adapter.ts";

interface Command {
  type?: unknown;
  sessionId?: unknown;
  project?: unknown;
  name?: unknown;
  text?: unknown;
  provider?: unknown;
  modelId?: unknown;
  level?: unknown;
  apiKey?: unknown;
  authType?: unknown;
  loginId?: unknown;
  value?: unknown;
}

export interface ProviderManager {
  getProviderSettings: PiAdapter["getProviderSettings"];
  setProviderApiKey: PiAdapter["setProviderApiKey"];
  getProviderApiKey: PiAdapter["getProviderApiKey"];
  logoutProvider: PiAdapter["logoutProvider"];
  startProviderLogin: PiAdapter["startProviderLogin"];
  submitProviderLogin: PiAdapter["submitProviderLogin"];
  cancelProviderLogin: PiAdapter["cancelProviderLogin"];
}

export class Transport {
  readonly server;
  readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  readonly hub: SessionHub;
  readonly configuration: Configuration;
  readonly heartbeat: ReturnType<typeof setInterval>;
  readonly alive = new Map<WebSocket, boolean>();

  readonly providers?: ProviderManager;

  constructor(hub: SessionHub, configuration: Configuration, webDirectory: string, pingInterval = 30_000, providers?: ProviderManager) {
    this.hub = hub;
    this.configuration = configuration;
    this.providers = providers;
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
    const handlers = this.getCommandHandlers(client, command);
    if (typeof command?.type !== "string" || !Object.hasOwn(handlers, command.type)) throw new Error("Unknown command.");
    await handlers[command.type]();
  }

  getCommandHandlers(client: HubClient, command: Command): Record<string, () => void | Promise<void>> {
    return {
      list_sessions: async () => client.send(JSON.stringify(await this.hub.getSessionList())),
      new_session: () => this.createSession(client, command),
      new_group: () => this.createGroup(client, command),
      remove_group: () => this.removeGroup(client, command),
      subscribe: () => this.hub.subscribe(client, requireSessionId(command)),
      unsubscribe: () => this.hub.unsubscribe(client, requireSessionId(command)),
      prompt: () => this.hub.prompt(requireSessionId(command), requireText(command)),
      steer: () => this.hub.queue(requireSessionId(command), requireText(command), "steer"),
      follow_up: () => this.hub.queue(requireSessionId(command), requireText(command), "follow_up"),
      steer_follow_up: () => this.hub.steerFollowUp(requireSessionId(command), requireText(command)),
      set_model: () => this.hub.setModel(requireSessionId(command), requireString(command.provider), requireString(command.modelId)),
      set_thinking_level: () => this.hub.setThinkingLevel(requireSessionId(command), requireString(command.level)),
      abort: () => this.hub.abort(requireSessionId(command)),
      list_providers: () => this.listProviders(client),
      set_provider_key: () => this.setProviderKey(client, command),
      get_provider_key: () => this.getProviderKey(client, command),
      logout_provider: () => this.logoutProvider(client, command),
      start_provider_login: () => this.startProviderLogin(client, command),
      submit_provider_login: () => this.submitProviderLogin(command),
      cancel_provider_login: () => this.cancelProviderLogin(command),
    };
  }

  private async listProviders(client: HubClient): Promise<void> {
    client.send(JSON.stringify({ type: "providers", providers: await this.requireProviders().getProviderSettings() }));
  }

  private async setProviderKey(client: HubClient, command: Command): Promise<void> {
    await this.requireProviders().setProviderApiKey(requireString(command.provider), requireString(command.apiKey));
    await this.listProviders(client);
  }

  private async getProviderKey(client: HubClient, command: Command): Promise<void> {
    const provider = requireString(command.provider);
    client.send(JSON.stringify({ type: "provider_key", provider, apiKey: await this.requireProviders().getProviderApiKey(provider) }));
  }

  private async logoutProvider(client: HubClient, command: Command): Promise<void> {
    await this.requireProviders().logoutProvider(requireString(command.provider));
    await this.listProviders(client);
  }

  private startProviderLogin(client: HubClient, command: Command): void {
    let loginId = "";
    const queuedEvents: unknown[] = [];
    const sendEvent = (event: { type: string }) => {
      if (!loginId) return queuedEvents.push(event);
      client.send(JSON.stringify({ type: "provider_login_event", loginId, event }));
      if (event.type === "complete") void this.listProviders(client);
    };
    loginId = this.requireProviders().startProviderLogin(requireString(command.provider), requireAuthType(command.authType), sendEvent);
    client.send(JSON.stringify({ type: "provider_login_started", loginId }));
    for (const event of queuedEvents as { type: string }[]) sendEvent(event);
  }

  private submitProviderLogin(command: Command): void {
    this.requireProviders().submitProviderLogin(requireString(command.loginId), requireString(command.value));
  }

  private cancelProviderLogin(command: Command): void {
    this.requireProviders().cancelProviderLogin(requireString(command.loginId));
  }

  private requireProviders(): ProviderManager {
    if (!this.providers) throw new Error("Provider settings are unavailable.");
    return this.providers;
  }

  async createGroup(client: HubClient, command: Command): Promise<void> {
    if (typeof command.name !== "string") throw new Error("The group name must be a string.");
    const project = await this.hub.createGroup(command.name);
    client.send(JSON.stringify({ type: "group_created", project }));
  }

  async removeGroup(client: HubClient, command: Command): Promise<void> {
    await this.hub.removeGroup(requireString(command.project));
    client.send(JSON.stringify(await this.hub.getSessionList()));
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

function requireString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("The setting must be a nonempty string.");
  return value;
}

function requireSessionId(command: Command): string {
  if (typeof command.sessionId !== "string" || !command.sessionId) throw new Error("The sessionId must be a nonempty string.");
  return command.sessionId;
}

function requireText(command: Command): string {
  if (typeof command.text !== "string" || !command.text.trim()) throw new Error("The prompt text must be a nonempty string.");
  return command.text;
}

function requireAuthType(value: unknown): "api_key" | "oauth" {
  if (value === "api_key" || value === "oauth") return value;
  throw new Error("The login type must be api_key or oauth.");
}

function sessionIdOf(data: RawData): string | undefined {
  try {
    const { sessionId } = JSON.parse(data.toString());
    return typeof sessionId === "string" ? sessionId : undefined;
  } catch {
    return undefined;
  }
}
