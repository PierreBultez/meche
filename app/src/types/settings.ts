// Mirrors the Rust types in src-tauri/src/db/settings.rs (keep both in sync).

export type ThemePreference = "system" | "light" | "dark";

export interface Settings {
  theme: ThemePreference;
  /** Width of the note list column, in pixels (220 to 520). */
  listWidth: number;
  /** Wrap long lines in code notes. */
  codeLineWrap: boolean;
  /** Delay of the fuses lit from now on, in hours (1, 24, 72, 168 or 720). */
  fuseDelayHours: number;
  /** The first launch screen was answered (docs/08). */
  welcomeDone: boolean;
}

/** Partial update: only the fields present are saved. */
export type SettingsPatch = Partial<Settings>;
