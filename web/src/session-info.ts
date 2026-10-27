import type { SessionInfo } from "../../server/src/protocol.ts";

const numberFormat = new Intl.NumberFormat();
const costFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

export function formatSessionInfo(info: SessionInfo): string {
  const count = (value: number) => numberFormat.format(value);
  const context = info.contextUsage;
  const rows = [
    ["Messages", `${count(info.userMessages)} from you, ${count(info.assistantMessages)} from pi`],
    ["Tool calls", count(info.toolCalls)],
    ["Tokens", `${count(info.tokens.input)} in, ${count(info.tokens.output)} out, ${count(info.tokens.total)} total`],
    ["Cache", `${count(info.tokens.cacheRead)} read, ${count(info.tokens.cacheWrite)} written`],
    ["Cost", costFormat.format(info.cost)],
    [
      "Context",
      context?.tokens == null
        ? "Unknown until the next reply"
        : `${count(context.tokens)} of ${count(context.contextWindow)} (${Math.round(context.percent ?? 0)}%)`,
    ],
  ];
  return ["**Session info**", "", ...rows.map(([label, value]) => `- ${label}: ${value}`)].join("\n");
}
