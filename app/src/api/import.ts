// Typed wrappers around the Rust commands of src-tauri/src/commands/import.rs (docs/07).
import { invoke } from "@tauri-apps/api/core";
import type { Backup, ImportResult, ImportedNote, Triage, TriageDecision, TriageUndo } from "../import/types";

/** Opens the system's file chooser (in Rust) and reads the backup; null when cancelled. */
export function readImportFile(): Promise<Backup | null> {
  return invoke<Backup | null>("read_import_file");
}

export function importNotes(notes: ImportedNote[]): Promise<ImportResult> {
  return invoke<ImportResult>("import_notes", { notes });
}

export function getTriage(): Promise<Triage> {
  return invoke<Triage>("get_triage");
}

export function triageDecide(id: string, decision: TriageDecision): Promise<TriageUndo> {
  return invoke<TriageUndo>("triage_decide", { id, decision });
}

export function triageUndo(undo: TriageUndo): Promise<void> {
  return invoke<void>("triage_undo", { undo });
}

export function finishTriage(): Promise<void> {
  return invoke<void>("finish_triage");
}
