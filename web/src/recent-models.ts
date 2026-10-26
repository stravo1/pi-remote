import type { ModelChoice } from "../../server/src/pi-adapter.ts";

const storageKey = "pi-remote.recent-models";
const limit = 4;

export function getModelKey(model: ModelChoice): string {
  return `${model.provider}/${model.id}`;
}

export function loadRecentKeys(): string[] {
  try {
    const keys = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

export function rememberModel(keys: string[], model: ModelChoice): string[] {
  const next = [getModelKey(model), ...keys.filter((key) => key !== getModelKey(model))].slice(0, limit);
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Storage can be blocked. The list then lasts for this page only.
  }
  return next;
}
