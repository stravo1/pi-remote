import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import webpush, { WebPushError, type PushSubscription } from "web-push";
import type { Configuration } from "./config.ts";

export interface RunNotice {
  sessionId: string;
  title: string;
  body: string;
}

interface PushState {
  publicKey: string;
  privateKey: string;
  subscriptions: PushSubscription[];
}

type Send = typeof webpush.sendNotification;

const maxSubscriptions = 20;

export class PushNotifier {
  private readonly settings: NonNullable<Configuration["push"]>;
  private readonly send: Send;
  private state: PushState;
  private saving = Promise.resolve();

  constructor(settings: NonNullable<Configuration["push"]>, state: PushState, send: Send) {
    this.settings = settings;
    this.state = state;
    this.send = send;
  }

  static async load(settings: NonNullable<Configuration["push"]>, send: Send = webpush.sendNotification) {
    const state = (await readState(settings.file)) ?? { ...webpush.generateVAPIDKeys(), subscriptions: [] };
    const notifier = new PushNotifier(settings, state, send);
    await notifier.save();
    return notifier;
  }

  get publicKey(): string {
    return this.state.publicKey;
  }

  get subscriptions(): readonly PushSubscription[] {
    return this.state.subscriptions;
  }

  async subscribe(value: unknown): Promise<void> {
    const subscription = requireSubscription(value);
    const others = this.state.subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
    this.state.subscriptions = [...others, subscription].slice(-maxSubscriptions);
    await this.save();
  }

  async unsubscribe(endpoint: string): Promise<void> {
    this.state.subscriptions = this.state.subscriptions.filter((item) => item.endpoint !== endpoint);
    await this.save();
  }

  async notify(notice: RunNotice): Promise<void> {
    const payload = JSON.stringify(notice);
    const expired = new Set<string>();
    await Promise.all(
      this.state.subscriptions.map(async (subscription) => {
        try {
          await this.send(subscription, payload, { vapidDetails: this.vapidDetails, TTL: 3600, urgency: "high" });
        } catch (error) {
          if (error instanceof WebPushError && [404, 410].includes(error.statusCode))
            expired.add(subscription.endpoint);
          else console.error("Push notification failed", new URL(subscription.endpoint).host, error);
        }
      }),
    );
    if (!expired.size) return;
    this.state.subscriptions = this.state.subscriptions.filter((item) => !expired.has(item.endpoint));
    await this.save();
  }

  private get vapidDetails() {
    return { subject: this.settings.contact, publicKey: this.state.publicKey, privateKey: this.state.privateKey };
  }

  private save(): Promise<void> {
    const file = this.settings.file;
    const contents = JSON.stringify(this.state, null, 2);
    this.saving = this.saving.then(async () => {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(`${file}.tmp`, contents, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    return this.saving;
  }
}

async function readState(file: string): Promise<PushState | undefined> {
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const state = JSON.parse(contents);
  if (
    typeof state?.publicKey !== "string" ||
    typeof state.privateKey !== "string" ||
    !Array.isArray(state.subscriptions)
  )
    throw new Error(`The push file is corrupt: ${file}`);
  return state;
}

function requireSubscription(value: unknown): PushSubscription {
  const subscription = value as PushSubscription | undefined;
  const isValid =
    typeof subscription?.endpoint === "string" &&
    subscription.endpoint.startsWith("https://") &&
    typeof subscription.keys?.p256dh === "string" &&
    typeof subscription.keys.auth === "string";
  if (!isValid) throw new Error("The push subscription is invalid.");
  const { endpoint, keys } = subscription;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
