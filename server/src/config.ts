import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

export interface Configuration {
  host: "127.0.0.1";
  port: number;
  origin: string;
  allowedUser: string;
  idleMinutes: number;
  projectsRoot: string;
  model?: { provider: string; id: string };
  push?: { contact: string; file: string };
}

function requireField(condition: unknown, field: string, description: string): asserts condition {
  if (!condition) throw new Error(`Invalid configuration field "${field}": ${description}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getConfiguration(value: unknown): Configuration {
  requireField(isRecord(value), "configuration", "use a JSON object");
  requireField(value.host === "127.0.0.1", "host", "use 127.0.0.1");
  requireField(isPort(value.port), "port", "use an integer from 1 to 65535");
  requireField(
    typeof value.origin === "string" && isOrigin(value.origin),
    "origin",
    "use an HTTP or HTTPS origin without a path",
  );
  requireField(isNonemptyString(value.allowedUser), "allowedUser", "use a nonempty user name");
  requireField(isPositiveNumber(value.idleMinutes), "idleMinutes", "use a positive number");
  requireField(
    isNonemptyString(value.projectsRoot) && isAbsolute(value.projectsRoot),
    "projectsRoot",
    "use an absolute path",
  );
  requireField(value.projects === undefined, "projects", "use projectsRoot instead");
  if (value.model !== undefined) validateModel(value.model);
  if (value.push !== undefined) validatePush(value.push);
  return value as unknown as Configuration;
}

function isPort(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65535;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

function validateModel(value: unknown): void {
  requireField(isRecord(value), "model", "use an object with provider and id");
  for (const field of ["provider", "id"]) {
    requireField(isNonemptyString(value[field]), `model.${field}`, "use a nonempty string");
  }
}

function validatePush(value: unknown): void {
  requireField(isRecord(value), "push", "use an object with contact and file");
  requireField(
    typeof value.contact === "string" && /^(mailto:|https:\/\/)\S+$/.test(value.contact),
    "push.contact",
    "use a mailto: or https:// address",
  );
  requireField(isNonemptyString(value.file) && isAbsolute(value.file), "push.file", "use an absolute path");
}

export async function getConfigurationFile(path: string | undefined): Promise<Configuration> {
  if (!path) throw new Error("Usage: npm start -- /absolute/path/to/config.json");
  const contents = await readFile(path, "utf8");
  return getConfiguration(JSON.parse(contents));
}
