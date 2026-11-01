import type { ContextUsage, SessionInfo } from "../../server/src/protocol.ts";

const numberFormat = new Intl.NumberFormat();
const costFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

/** pi reports null tokens right after a compaction, until the next reply settles. */
export function formatContextUsage(usage: ContextUsage | undefined): string {
  if (usage?.tokens == null) return "Unknown until the next reply";
  const percent = Math.round(usage.percent ?? 0);
  return `${numberFormat.format(usage.tokens)} of ${numberFormat.format(usage.contextWindow)} (${percent}%)`;
}

export function formatSessionInfo(info: SessionInfo): string {
  const count = (value: number) => numberFormat.format(value);
  const rows = [
    ["Messages", `${count(info.userMessages)} from you, ${count(info.assistantMessages)} from pi`],
    ["Tool calls", count(info.toolCalls)],
    ["Tokens", `${count(info.tokens.input)} in, ${count(info.tokens.output)} out, ${count(info.tokens.total)} total`],
    ["Cache", `${count(info.tokens.cacheRead)} read, ${count(info.tokens.cacheWrite)} written`],
    ["Cost", costFormat.format(info.cost)],
    ["Context", formatContextUsage(info.contextUsage)],
  ];
  return ["**Session info**", "", ...rows.map(([label, value]) => `- ${label}: ${value}`)].join("\n");
}
