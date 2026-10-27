import { open, stat } from "node:fs/promises";

interface CachedActivity {
  offset: number;
  lastUserMessage?: number;
}

interface ActivityEntry {
  type?: string;
  timestamp?: string;
  message?: { role?: string; timestamp?: number };
}

/**
 * Finds when the user last sent a message in each session file.
 * Session files only grow, so each read starts where the previous one stopped.
 */
export class SessionActivity {
  private readonly files = new Map<string, CachedActivity>();
  private readonly pending = new Map<string, Promise<number | undefined>>();

  /** Calls for one file run in order, so two list requests cannot both advance its offset. */
  lastUserMessage(path: string): Promise<number | undefined> {
    const previous = this.pending.get(path) ?? Promise.resolve(undefined);
    const next = previous.catch(() => undefined).then(() => this.read(path));
    this.pending.set(path, next);
    next
      .finally(() => {
        if (this.pending.get(path) === next) this.pending.delete(path);
      })
      .catch(() => undefined);
    return next;
  }

  private async read(path: string): Promise<number | undefined> {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      this.files.delete(path);
      return undefined;
    }
    const cached = this.files.get(path);
    const entry = cached && size >= cached.offset ? cached : { offset: 0 };
    try {
      if (size > entry.offset) await this.scan(path, entry, size);
    } catch {
      // A file can vanish between stat and open. Keep what the earlier reads found.
    }
    this.files.set(path, entry);
    return entry.lastUserMessage;
  }

  private async scan(path: string, entry: CachedActivity, size: number): Promise<void> {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(size - entry.offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, entry.offset);
      const text = buffer.toString("utf8", 0, bytesRead);
      const end = text.lastIndexOf("\n");
      const complete = end === -1 ? "" : text.slice(0, end + 1);
      const rest = text.slice(end + 1);
      for (const line of complete.split("\n")) this.readLine(entry, line);
      // A final line without a newline counts once it parses.
      if (rest.trim() && this.readLine(entry, rest)) entry.offset += bytesRead;
      else entry.offset += Buffer.byteLength(complete);
    } finally {
      await handle.close();
    }
  }

  private readLine(entry: CachedActivity, line: string): boolean {
    if (!line.trim()) return true;
    try {
      const value = JSON.parse(line) as ActivityEntry;
      if (value.type === "message" && value.message?.role === "user") {
        const time =
          typeof value.message.timestamp === "number" ? value.message.timestamp : Date.parse(value.timestamp ?? "");
        if (Number.isFinite(time)) entry.lastUserMessage = Math.max(entry.lastUserMessage ?? 0, time);
      }
      return true;
    } catch {
      // A line cut in the middle of a write is read again with the next chunk.
      return false;
    }
  }
}
