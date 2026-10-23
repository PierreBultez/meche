//! Note commands (docs/02, "Commandes Tauri"). Each one locks the database, calls `db::notes`
//! and returns the result; the time is read here so that `db::notes` stays testable.

use tauri::State;

use crate::AppState;
use crate::db::notes::{self, ListFilter, Note, NoteKind, NotePatch, NoteSummary};
use crate::db::search::{self, SearchResult};
use crate::db::settings;
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

/// `fused`: « Nouvelle note à mèche », the fuse is lit with the delay of the settings.
/// `Option`: the frontend may leave the argument out.
#[tauri::command]
pub async fn create_note(
    state: State<'_, AppState>,
    kind: NoteKind,
    fused: Option<bool>,
) -> Result<Note> {
    let conn = state.lock_db()?;
    if fused == Some(true) {
        let delay_hours = settings::load(&conn)?.fuse_delay_hours;
        notes::create_fused(&conn, kind, delay_hours, now_ms())
    } else {
        notes::create(&conn, kind, now_ms())
    }
}

/// Lights or puts out the fuse of a note (docs/06). A fuse is lit with the delay of the settings.
#[tauri::command]
pub async fn set_ephemeral(state: State<'_, AppState>, id: String, enabled: bool) -> Result<Note> {
    let conn = state.lock_db()?;
    let delay_hours = settings::load(&conn)?.fuse_delay_hours;
    notes::set_ephemeral(&conn, &id, enabled, delay_hours, now_ms())
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

/// Full-text search, run at each keystroke (docs/08: under 30 ms for 1,000 notes).
#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: String) -> Result<Vec<SearchResult>> {
    let conn = state.lock_db()?;
    search::search(&conn, &query)
}

/// Returns how many notes were deleted.
#[tauri::command]
pub async fn empty_trash(state: State<'_, AppState>) -> Result<usize> {
    let mut conn = state.lock_db()?;
    notes::empty_trash(&mut conn, now_ms())
}
