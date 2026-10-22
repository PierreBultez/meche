// Typed wrappers around the Rust commands of src-tauri/src/commands/notes.rs.
import { invoke } from "@tauri-apps/api/core";
import type { ListFilter, Note, NoteKind, NotePatch, NoteSummary, SearchResult } from "../types/note";

export function listNotes(filter: ListFilter): Promise<NoteSummary[]> {
  return invoke<NoteSummary[]>("list_notes", { filter });
}

export function getNote(id: string): Promise<Note> {
  return invoke<Note>("get_note", { id });
}

export function createNote(kind: NoteKind): Promise<Note> {
  return invoke<Note>("create_note", { kind });
}

export function updateNote(id: string, patch: NotePatch): Promise<Note> {
  return invoke<Note>("update_note", { id, patch });
}

export function trashNote(id: string): Promise<void> {
  return invoke<void>("trash_note", { id });
}

export function restoreNote(id: string): Promise<void> {
  return invoke<void>("restore_note", { id });
}

export function deleteNoteForever(id: string): Promise<void> {
  return invoke<void>("delete_note_forever", { id });
}

/** Returns how many notes were deleted. */
export function emptyTrash(): Promise<number> {
  return invoke<number>("empty_trash");
}

export function searchNotes(query: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search", { query });
}
