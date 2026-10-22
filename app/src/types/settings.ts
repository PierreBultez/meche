// Mirrors the Rust types in src-tauri/src/db/settings.rs (keep both in sync).

export type ThemePreference = "system" | "light" | "dark";

export interface Settings {
  theme: ThemePreference;
}

/** Partial update: only the fields present are saved. */
export type SettingsPatch = Partial<Settings>;
