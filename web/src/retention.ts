/** The choices of the session retention setting. Custom opens a field for a day count. */
export const retentionOptions = [
  { label: "One day", value: "1" },
  { label: "One week", value: "7" },
  { label: "One month", value: "30" },
  { label: "Never", value: "never" },
  { label: "Custom", value: "custom" },
];

const presetValues = new Set(["1", "7", "30"]);

/** Maps the stored days to a select value. Undefined means the server has not answered yet. */
export function getRetentionChoice(days?: number | null): string {
  if (days === undefined) return "";
  if (days === null) return "never";
  return presetValues.has(String(days)) ? String(days) : "custom";
}

/** Maps a select value to days. Undefined means the value asks for a custom day count. */
export function getRetentionDays(value: string): number | null | undefined {
  if (value === "never") return null;
  return presetValues.has(value) ? Number(value) : undefined;
}

/** Reads a typed day count. Undefined means the text is not a whole number of days. */
export function getDayCount(value: string): number | undefined {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 ? days : undefined;
}
