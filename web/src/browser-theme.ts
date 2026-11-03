import type { ResolvedColorScheme } from "frappe-ui";

// The installed app paints its status bar from `theme-color` and picks the
// status bar text color from `color-scheme`. Both follow the scheme on screen,
// which can differ from the device setting.
// The colors match the `surface-base` token in both schemes.
const THEME_COLORS: Record<ResolvedColorScheme, string> = {
  light: "#ffffff",
  dark: "#171717",
};

// A tab bar follows the scheme on screen too, so the icon switches with it
// rather than with the device setting.
const FAVICONS: Record<ResolvedColorScheme, string> = {
  light: "/favicon-light.svg",
  dark: "/favicon-dark.svg",
};

export function applyBrowserTheme(scheme: ResolvedColorScheme): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[scheme]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", scheme);
  document.querySelector('link[rel="icon"]')?.setAttribute("href", FAVICONS[scheme]);
}
