// Typed wrappers around the Rust commands of src-tauri/src/commands/notes.rs.
import { invoke } from "@tauri-apps/api/core";
import type { ListFilter, Note, NoteKind, NotePatch, NoteSummary, SearchResult } from "../types/note";

export function listNotes(filter: ListFilter): Promise<NoteSummary[]> {
  return invoke<NoteSummary[]>("list_notes", { filter });
}

export function getNote(id: string): Promise<Note> {
  return invoke<Note>("get_note", { id });
}

/** `fused`: the fuse of the new note is lit with the delay of the settings. */
export function createNote(kind: NoteKind, fused = false): Promise<Note> {
  return invoke<Note>("create_note", { kind, fused });
}

/** Lights (`enabled`) or puts out the fuse of a note, and returns it (docs/06). */
export function setEphemeral(id: string, enabled: boolean): Promise<Note> {
  return invoke<Note>("set_ephemeral", { id, enabled });
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
