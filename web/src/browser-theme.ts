import type { ResolvedColorScheme } from "frappe-ui";

// The installed app paints its status bar from `theme-color` and picks the
// status bar text color from `color-scheme`. Both follow the scheme on screen,
// which can differ from the device setting.
// The colors match the `surface-base` token in both schemes.
const THEME_COLORS: Record<ResolvedColorScheme, string> = {
  light: "#ffffff",
  dark: "#171717",
};

export function applyBrowserTheme(scheme: ResolvedColorScheme): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[scheme]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", scheme);
}
