//! Note commands (docs/02, "Commandes Tauri"). Each one locks the database, calls `db::notes`
//! and returns the result; the time is read here so that `db::notes` stays testable.

use tauri::State;

use crate::AppState;
use crate::db::notes::{self, ListFilter, Note, NoteKind, NotePatch, NoteSummary};
use crate::error::Result;
use crate::time::now_ms;

// `id: String` (owned) rather than `&str`: Tauri builds the arguments from the JSON sent by the
// frontend, so the command receives values it owns.

#[tauri::command]
pub async fn list_notes(
    state: State<'_, AppState>,
    filter: ListFilter,
) -> Result<Vec<NoteSummary>> {
    let conn = state.lock_db()?;
    notes::list(&conn, filter)
}

#[tauri::command]
pub async fn get_note(state: State<'_, AppState>, id: String) -> Result<Note> {
    let conn = state.lock_db()?;
    notes::get(&conn, &id)
}

#[tauri::command]
pub async fn create_note(state: State<'_, AppState>, kind: NoteKind) -> Result<Note> {
    let conn = state.lock_db()?;
    notes::create(&conn, kind, now_ms())
}

#[tauri::command]
pub async fn update_note(state: State<'_, AppState>, id: String, patch: NotePatch) -> Result<Note> {
    let conn = state.lock_db()?;
    notes::update(&conn, &id, patch, now_ms())
}

#[tauri::command]
pub async fn trash_note(state: State<'_, AppState>, id: String) -> Result<()> {
    let conn = state.lock_db()?;
    notes::trash(&conn, &id, now_ms())
}

#[tauri::command]
pub async fn restore_note(state: State<'_, AppState>, id: String) -> Result<()> {
    let conn = state.lock_db()?;
    notes::restore(&conn, &id, now_ms())
}

#[tauri::command]
pub async fn delete_note_forever(state: State<'_, AppState>, id: String) -> Result<()> {
    let conn = state.lock_db()?;
    notes::delete_forever(&conn, &id, now_ms())
}

/// Returns how many notes were deleted.
#[tauri::command]
pub async fn empty_trash(state: State<'_, AppState>) -> Result<usize> {
    let mut conn = state.lock_db()?;
    notes::empty_trash(&mut conn, now_ms())
}
