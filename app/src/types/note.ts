// Mirrors the Rust types of src-tauri/src/db/notes.rs and db/search.rs (keep them in sync).
import type { NoteColor } from "../theme/note-colors";

export type { NoteColor };
export type NoteKind = "rich" | "code";
export type EphemeralMode = "delay" | "on_complete";
export type TrashReason = "manual" | "self_destruct";
export type ListFilter = "all" | "pinned" | "ephemeral" | "trash";

/** A complete note (get_note). Dates are milliseconds since 1970 (UTC). */
export interface Note {
  id: string;
  title: string;
  content: string;
  kind: NoteKind;
  codeLanguage: string | null;
  pinned: boolean;
  color: NoteColor;
  ephemeralMode: EphemeralMode | null;
  ephemeralDelayHours: number | null;
  ephemeralStartedAt: number | null;
  destroyAt: number | null;
  trashedAt: number | null;
  trashReason: TrashReason | null;
  createdAt: number;
  updatedAt: number;
}

/** One line of the note list (list_notes). */
export interface NoteSummary {
  id: string;
  /** The title, or the first line of the content when the title is empty. */
  title: string;
  preview: string;
  kind: NoteKind;
  codeLanguage: string | null;
  pinned: boolean;
  color: NoteColor;
  ephemeralMode: EphemeralMode | null;
  destroyAt: number | null;
  trashedAt: number | null;
  updatedAt: number;
}

/** Partial update (update_note). Changing `kind` converts the content. */
export interface NotePatch {
  title?: string;
  content?: string;
  kind?: NoteKind;
  codeLanguage?: string;
  pinned?: boolean;
  color?: NoteColor;
}

/** One search result: matches in `excerpt` are wrapped in MATCH_START / MATCH_END. */
export interface SearchResult {
  id: string;
  title: string;
  excerpt: string;
  kind: NoteKind;
  color: NoteColor;
  pinned: boolean;
  updatedAt: number;
}

export const MATCH_START = "\u{E000}";
export const MATCH_END = "\u{E001}";

/** Error sent by a Rust command (src-tauri/src/error.rs). */
export interface CommandError {
  kind: string;
  message: string;
}
