import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const folderName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class ProjectStore {
  readonly root?: string;
  private groups?: string[];
  private pending: Promise<unknown> = Promise.resolve();

  constructor(root?: string) {
    this.root = root;
  }

  get is_enabled(): boolean {
    return this.root !== undefined;
  }

  async list(): Promise<string[]> {
    if (!this.is_enabled) return [];
    this.groups ??= await this.load();
    return [...this.groups];
  }

  create(name: string): Promise<string> {
    const created = this.pending.then(() => this.add(name));
    this.pending = created.catch(() => {});
    return created;
  }

  remove(path: string): Promise<void> {
    const removed = this.pending.then(() => this.delete(path));
    this.pending = removed.catch(() => {});
    return removed;
  }

  private get file(): string {
    return join(this.root!, ".pi-remote", "projects.json");
  }

  private async add(name: string): Promise<string> {
    if (!this.is_enabled) throw new Error("Creating groups is not enabled.");
    if (!folderName.test(name)) throw new Error("Use letters, numbers, dots, dashes, or underscores. Start with a letter or number.");
    const path = join(this.root!, name);
    await mkdir(path, { recursive: true });
    if (!(await lstat(path)).isDirectory()) throw new Error("That name is not a folder.");
    const groups = await this.list();
    if (!groups.includes(path)) await this.save([...groups, path]);
    return path;
  }

  private async delete(path: string): Promise<void> {
    const groups = await this.list();
    if (!groups.includes(path)) throw new Error("Unknown project.");
    await this.save(groups.filter((group) => group !== path));
  }

  private async load(): Promise<string[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async save(groups: string[]): Promise<void> {
    await mkdir(join(this.root!, ".pi-remote"), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(groups, null, 2));
    await rename(`${this.file}.tmp`, this.file);
    this.groups = groups;
  }
}
