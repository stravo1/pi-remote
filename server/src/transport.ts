import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { Configuration } from "./config.ts";
import { serveHttp } from "./http.ts";
import type { HubClient, SessionHub } from "./session-hub.ts";
import type { PiAdapter } from "./pi-adapter.ts";
import type { PromptImage } from "./protocol.ts";
import type { PushNotifier } from "./push-notifier.ts";

interface Command {
  type?: unknown;
  sessionId?: unknown;
  project?: unknown;
  name?: unknown;
  text?: unknown;
  id?: unknown;
  provider?: unknown;
  modelId?: unknown;
  level?: unknown;
  apiKey?: unknown;
  authType?: unknown;
  loginId?: unknown;
  value?: unknown;
  deleteFolder?: unknown;
  sessionIds?: unknown;
  instructions?: unknown;
  images?: unknown;
  subscription?: unknown;
  endpoint?: unknown;
}

export interface ProviderManager {
  getProviderSettings: PiAdapter["getProviderSettings"];
  setProviderApiKey: PiAdapter["setProviderApiKey"];
  getProviderApiKey: PiAdapter["getProviderApiKey"];
  logoutProvider: PiAdapter["logoutProvider"];
  startProviderLogin: PiAdapter["startProviderLogin"];
  submitProviderLogin: PiAdapter["submitProviderLogin"];
  cancelProviderLogin: PiAdapter["cancelProviderLogin"];
  getDefaultModel: PiAdapter["getDefaultModel"];
  setDefaultModel: PiAdapter["setDefaultModel"];
}

export class Transport {
  readonly server;
  readonly sockets = new WebSocketServer({
    noServer: true,
    // Prompt frames can carry attached images. The client downscales images
    // before sending; four of them still fit well inside this bound.
    maxPayload: 12 * 1024 * 1024,
    perMessageDeflate: { threshold: 1024 },
  });
  readonly hub: SessionHub;
  readonly configuration: Configuration;
  readonly heartbeat: ReturnType<typeof setInterval>;
  readonly alive = new Map<WebSocket, boolean>();

  readonly providers?: ProviderManager;
  readonly push?: PushNotifier;

  constructor(
    hub: SessionHub,
    configuration: Configuration,
    webDirectory: string,
    pingInterval = 30_000,
    providers?: ProviderManager,
    push?: PushNotifier,
  ) {
    this.hub = hub;
    this.configuration = configuration;
    this.providers = providers;
    this.push = push;
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
    if (
      request.headers.origin !== this.configuration.origin ||
      request.headers["remote-user"] !== this.configuration.allowedUser
    ) {
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
    const client: HubClient = {
      send: (message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
      },
    };
    this.hub.addClient(client);
    this.alive.set(socket, true);
    socket.on("pong", () => this.alive.set(socket, true));
    socket.on("close", () => {
      this.alive.delete(socket);
      this.hub.removeClient(client);
    });
    socket.on("error", () => socket.terminate());
    socket.on("message", (data, isBinary) => {
      void this.command(client, data, isBinary).catch((error: unknown) => {
        client.send(
          JSON.stringify({
            type: "error",
            sessionId: sessionIdOf(data),
            message: error instanceof Error ? error.message : "The command failed.",
          }),
        );
      });
    });
  }

  async command(client: HubClient, data: RawData, isBinary: boolean): Promise<void> {
    if (isBinary) throw new Error("Send a JSON text message.");
    const command: Command = JSON.parse(data.toString());
    const handlers = this.getCommandHandlers(client, command);
    if (typeof command?.type !== "string" || !Object.hasOwn(handlers, command.type))
      throw new Error("Unknown command.");
    await handlers[command.type]();
  }

  getCommandHandlers(client: HubClient, command: Command): Record<string, () => void | Promise<void>> {
    return {
      list_sessions: async () => client.send(JSON.stringify(await this.hub.getSessionList())),
      new_session: () => this.createSession(client, command),
      new_group: () => this.createGroup(client, command),
      remove_group: () => this.removeGroup(client, command),
      delete_sessions: () => this.deleteSessions(client, command),
      subscribe: () => this.hub.subscribe(client, requireSessionId(command)),
      unsubscribe: () => this.hub.unsubscribe(client, requireSessionId(command)),
      prompt: () => {
        const images = requireImages(command.images);
        return this.hub.prompt(requireSessionId(command), requireText(command, !!images), images);
      },
      steer: () => {
        const images = requireImages(command.images);
        return this.hub.queue(requireSessionId(command), requireText(command, !!images), "steer", images);
      },
      follow_up: () => {
        const images = requireImages(command.images);
        return this.hub.queue(requireSessionId(command), requireText(command, !!images), "follow_up", images);
      },
      steer_follow_up: () => this.hub.steerFollowUp(requireSessionId(command), requireString(command.id, "id")),
      set_model: () =>
        this.hub.setModel(
          requireSessionId(command),
          requireString(command.provider, "provider"),
          requireString(command.modelId, "modelId"),
        ),
      set_thinking_level: () =>
        this.hub.setThinkingLevel(requireSessionId(command), requireString(command.level, "level")),
      rename_session: () => this.hub.rename(requireSessionId(command), requireString(command.name, "name")),
      get_session_info: () => this.sendSessionInfo(client, requireSessionId(command)),
      compact: () => this.hub.compact(requireSessionId(command), optionalString(command.instructions)),
      abort: () => this.hub.abort(requireSessionId(command)),
      list_providers: () => this.listProviders(client),
      get_default_model: () => this.sendDefaultModel(client),
      set_default_model: () => this.setDefaultModel(client, command),
      set_provider_key: () => this.setProviderKey(client, command),
      get_provider_key: () => this.getProviderKey(client, command),
      logout_provider: () => this.logoutProvider(client, command),
      start_provider_login: () => this.startProviderLogin(client, command),
      submit_provider_login: () => this.submitProviderLogin(command),
      cancel_provider_login: () => this.cancelProviderLogin(command),
      get_push_key: () => client.send(JSON.stringify({ type: "push_key", publicKey: this.push?.publicKey ?? null })),
      push_subscribe: () => this.subscribePush(client, command),
      push_unsubscribe: () => this.unsubscribePush(client, command),
      push_test: () =>
        this.requirePush().notify({ sessionId: "", title: "pi remote", body: "Notifications work on this device." }),
    };
  }

  private async sendSessionInfo(client: HubClient, sessionId: string): Promise<void> {
    const info = await this.hub.getSessionInfo(sessionId);
    client.send(JSON.stringify({ type: "session_info", sessionId, info }));
  }

  private async listProviders(client: HubClient): Promise<void> {
    client.send(JSON.stringify({ type: "providers", providers: await this.requireProviders().getProviderSettings() }));
  }

  /** Provider changes can move the default model, so the settings page gets both replies. */
  private async refreshProviders(client: HubClient): Promise<void> {
    await this.listProviders(client);
    await this.sendDefaultModel(client);
  }

  private async sendDefaultModel(client: HubClient): Promise<void> {
    client.send(JSON.stringify({ type: "default_model", ...this.requireProviders().getDefaultModel() }));
  }

  private async setDefaultModel(client: HubClient, command: Command): Promise<void> {
    const provider = typeof command.provider === "string" ? command.provider : "";
    const modelId = typeof command.modelId === "string" ? command.modelId : "";
    if (!!provider !== !!modelId) throw new Error("Send provider and modelId together, or neither to reset.");
    await this.requireProviders().setDefaultModel(provider, modelId);
    await this.sendDefaultModel(client);
  }

  private async setProviderKey(client: HubClient, command: Command): Promise<void> {
    await this.requireProviders().setProviderApiKey(
      requireString(command.provider, "provider"),
      requireString(command.apiKey, "API key"),
    );
    await this.refreshProviders(client);
  }

  private async getProviderKey(client: HubClient, command: Command): Promise<void> {
    const provider = requireString(command.provider, "provider");
    client.send(
      JSON.stringify({
        type: "provider_key",
        provider,
        apiKey: await this.requireProviders().getProviderApiKey(provider),
      }),
    );
  }

  private async logoutProvider(client: HubClient, command: Command): Promise<void> {
    await this.requireProviders().logoutProvider(requireString(command.provider, "provider"));
    await this.refreshProviders(client);
  }

  private startProviderLogin(client: HubClient, command: Command): void {
    let loginId = "";
    const queuedEvents: unknown[] = [];
    const sendEvent = (event: { type: string }) => {
      if (!loginId) return queuedEvents.push(event);
      client.send(JSON.stringify({ type: "provider_login_event", loginId, event }));
      if (event.type === "complete") void this.refreshProviders(client);
    };
    loginId = this.requireProviders().startProviderLogin(
      requireString(command.provider, "provider"),
      requireAuthType(command.authType),
      sendEvent,
    );
    client.send(JSON.stringify({ type: "provider_login_started", loginId }));
    for (const event of queuedEvents as { type: string }[]) sendEvent(event);
  }

  private submitProviderLogin(command: Command): void {
    this.requireProviders().submitProviderLogin(
      requireString(command.loginId, "loginId"),
      requireString(command.value, "value"),
    );
  }

  private cancelProviderLogin(command: Command): void {
    this.requireProviders().cancelProviderLogin(requireString(command.loginId, "loginId"));
  }

  private async subscribePush(client: HubClient, command: Command): Promise<void> {
    await this.requirePush().subscribe(command.subscription);
    client.send(JSON.stringify({ type: "push_subscribed" }));
  }

  private async unsubscribePush(client: HubClient, command: Command): Promise<void> {
    await this.requirePush().unsubscribe(requireString(command.endpoint, "endpoint"));
    client.send(JSON.stringify({ type: "push_unsubscribed" }));
  }

  private requirePush(): PushNotifier {
    if (!this.push) throw new Error("Push notifications are not set up on this server.");
    return this.push;
  }

  private requireProviders(): ProviderManager {
    if (!this.providers) throw new Error("Provider settings are unavailable.");
    return this.providers;
  }

  async createGroup(client: HubClient, command: Command): Promise<void> {
    const project = await this.hub.createGroup(requireString(command.name, "group name"));
    client.send(JSON.stringify({ type: "group_created", project }));
  }

  async removeGroup(client: HubClient, command: Command): Promise<void> {
    await this.hub.removeGroup(requireString(command.project, "project"), command.deleteFolder === true);
    client.send(JSON.stringify(await this.hub.getSessionList()));
  }

  async deleteSessions(client: HubClient, command: Command): Promise<void> {
    const { sessionIds } = command;
    if (!Array.isArray(sessionIds) || !sessionIds.length || !sessionIds.every((id) => typeof id === "string")) {
      throw new Error("The session IDs must be a nonempty list of strings.");
    }
    await this.hub.deleteSessions(sessionIds);
    client.send(JSON.stringify(await this.hub.getSessionList()));
  }

  async createSession(client: HubClient, command: Command): Promise<void> {
    const sessionId = await this.hub.createSession(requireString(command.project, "project"));
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
    if (this.server.listening)
      await new Promise<void>((resolve, reject) => {
        this.server.close((error) => (error ? reject(error) : resolve()));
      });
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`The ${field} must be a nonempty string.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || typeof value === "string") return value;
  throw new Error("The setting must be a string.");
}

function requireSessionId(command: Command): string {
  if (typeof command.sessionId !== "string" || !command.sessionId)
    throw new Error("The sessionId must be a nonempty string.");
  return command.sessionId;
}

function requireText(command: Command, allowEmpty = false): string {
  if (typeof command.text !== "string" || (!allowEmpty && !command.text.trim()))
    throw new Error("The prompt text must be a nonempty string.");
  return command.text;
}

const maxPromptImages = 4;
const maxImageBytes = 8 * 1024 * 1024;

function requireImages(value: unknown): PromptImage[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxPromptImages)
    throw new Error(`A prompt carries at most ${maxPromptImages} images.`);
  const images = value.map((item): PromptImage => {
    const { data, mimeType } = item as PromptImage;
    if (typeof data !== "string" || !data) throw new Error("An attached image is missing its data.");
    if (typeof mimeType !== "string" || !mimeType.startsWith("image/"))
      throw new Error("An attached image has an unsupported type.");
    // Base64 holds three bytes in four characters, so this bounds the decoded size.
    if (data.length > (maxImageBytes / 3) * 4) throw new Error("An attached image is too large.");
    return { data, mimeType };
  });
  return images.length ? images : undefined;
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
