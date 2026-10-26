// Types of the Standard Notes import (docs/07). Mirrors src-tauri/src/backup.rs, db/import.rs and
// db/triage.rs (keep them in sync).
import type { NoteColor, NoteKind } from "../types/note";

/** What `read_import_file` returns: the notes of a backup, as they are in it. */
export interface Backup {
  version: string | null;
  /** The `Note` items, unchecked: everything in them comes from a file and is verified here. */
  notes: unknown[];
  /** How many items of every other type the backup holds (`"SN|File": 12`…). */
  otherItems: Record<string, number>;
}

/** A converted note, as `import_notes` takes it. */
export interface ImportedNote {
  /** The Standard Notes uuid: it becomes the note's id, and a second import skips the note. */
  sourceId: string;
  title: string;
  content: string;
  kind: NoteKind;
  codeLanguage: string | null;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ImportResult {
  imported: number;
  alreadyImported: number;
}

/** Where a note comes from, for the summary (« 10 HTML, 8 Super… »). */
export type SourceFormat = "text" | "markdown" | "html" | "super" | "checklist" | "code" | "other";

/**
 * Something the conversion could not keep exactly. The note is still imported (except for
 * `too_large`), and the summary lists it so that it can be checked.
 * - `not_exact`: the Markdown does not read back as the converted note, or text was lost;
 * - `unsupported`: elements without Markdown equivalent (images, attached files…), dropped;
 * - `unreadable`: the content was not in the expected format, imported as plain text;
 * - `unknown_type`: a note type Mèche does not know, imported as a plain text code note;
 * - `raw_html`: HTML inside a Markdown note, which rich notes cannot keep;
 * - `title_cut`: a title longer than 500 characters;
 * - `too_large`: more than 2 MB once converted: not imported.
 */
export type WarningCode =
  | "not_exact"
  | "unsupported"
  | "unreadable"
  | "unknown_type"
  | "raw_html"
  | "title_cut"
  | "too_large";

export interface ImportWarning {
  code: WarningCode;
  /** For `unsupported`: what was dropped (`image`, `snfile`, `iframe`…). */
  detail?: string;
}

/** One note of the backup, converted. */
export interface PlannedNote {
  note: ImportedNote;
  format: SourceFormat;
  warnings: ImportWarning[];
  /** False when the note cannot be imported (`too_large`). */
  importable: boolean;
}

/** The summary shown before importing. */
export interface ImportPlan {
  notes: PlannedNote[];
  /** Notes left out: in the Standard Notes trash, deleted, or not readable at all. */
  skipped: { trashed: number; deleted: number; unreadable: number };
  otherItems: Record<string, number>;
}

// ── Triage (db/triage.rs) ──────────────────────────────────────────────────────────────────

export type TriageDecision = "keep" | "fuse" | "trash" | "skip";

export interface TriageCard {
  id: string;
  title: string;
  kind: NoteKind;
  color: NoteColor;
  updatedAt: number;
}

export interface TriageCounts {
  kept: number;
  fused: number;
  trashed: number;
}

export interface Triage {
  cards: TriageCard[];
  counts: TriageCounts;
  total: number;
}

/** Returned by `triage_decide`, given back to `triage_undo`. */
export interface TriageUndo {
  noteId: string;
  decision: TriageDecision;
  position: number;
  updatedAt: number;
  decidedAt: number;
  changed: boolean;
}
