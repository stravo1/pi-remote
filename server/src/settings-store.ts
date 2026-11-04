import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Days to keep a session after its last user message. Null keeps every session. */
export type RetentionDays = number | null;

interface Settings {
  retentionDays: RetentionDays;
}

/** The app settings that belong to the host, stored beside the project list. */
export class SettingsStore {
  readonly root: string;
  private retentionDays?: RetentionDays;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.root = root;
  }

  async get_retention(): Promise<RetentionDays> {
    this.retentionDays ??= await this.load();
    return this.retentionDays;
  }

  /** Fails loudly on a bad value, so a corrupt period never reaches the session list. */
  async set_retention(value: unknown): Promise<void> {
    const retentionDays = requireRetentionDays(value);
    const updated = this.pending.then(() => this.save({ retentionDays }));
    this.pending = updated.catch(() => {});
    await updated;
  }

  private get file(): string {
    return join(this.root, ".pi-remote", "settings.json");
  }

  private async load(): Promise<RetentionDays> {
    let contents: string;
    try {
      contents = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return requireRetentionDays(JSON.parse(contents)?.retentionDays ?? null);
  }

  private async save(settings: Settings): Promise<void> {
    await mkdir(join(this.root, ".pi-remote"), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(settings, null, 2));
    await rename(`${this.file}.tmp`, this.file);
    this.retentionDays = settings.retentionDays;
  }
}

export function requireRetentionDays(value: unknown): RetentionDays {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
  throw new Error("The retention period must be null or a whole number of days.");
}
