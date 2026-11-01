import type { ContextUsage, SessionInfo } from "../../server/src/protocol.ts";

const numberFormat = new Intl.NumberFormat();
const compactNumberFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 0 });
const costFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

/**
 * pi reports null tokens right after a compaction, until the next reply settles.
 * The drawer is a glance and asks for compact counts; the `/session` note keeps exact ones.
 */
export function formatContextUsage(usage: ContextUsage | undefined, isCompact = false): string {
  if (usage?.tokens == null) return "Unknown until the next reply";
  const formatCount = isCompact ? compactNumberFormat.format : numberFormat.format;
  const percent = Math.round(usage.percent ?? 0);
  return `${formatCount(usage.tokens)} of ${formatCount(usage.contextWindow)} (${percent}%)`;
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
