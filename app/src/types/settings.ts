// Mirrors the Rust types in src-tauri/src/db/settings.rs (keep both in sync).

export type ThemePreference = "system" | "light" | "dark";

export interface Settings {
  theme: ThemePreference;
  /** Width of the note list column, in pixels (220 to 520). */
  listWidth: number;
  /** Wrap long lines in code notes. */
  codeLineWrap: boolean;
}

/** Partial update: only the fields present are saved. */
export type SettingsPatch = Partial<Settings>;
