import type { ThemePreference } from "../types/settings";

/** The theme actually displayed: "system" resolves to one of these two. */
export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(preference: ThemePreference, system: ResolvedTheme): ResolvedTheme {
  return preference === "system" ? system : preference;
}

export function readSystemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** Calls `listener` whenever the system switches between light and dark. Returns an unsubscribe function. */
export function watchSystemTheme(listener: (theme: ResolvedTheme) => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  const onChange = (event: MediaQueryListEvent) => listener(event.matches ? "dark" : "light");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Switches the whole UI instantly: tokens.css reacts to `data-theme` on <html>. */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}
