//! Note commands (docs/02, "Commandes Tauri"). Each one locks the database, calls `db::notes`
//! and returns the result; the time is read here so that `db::notes` stays testable.

use tauri::{AppHandle, State};

use crate::AppState;
use crate::db::notes::{self, ListFilter, Note, NoteKind, NotePatch, NoteSummary};
use crate::db::search::{self, SearchResult};
use crate::db::settings;
use crate::ephemeral::{self, watcher};
use crate::error::Result;
use crate::time::now_ms;

// `id: String` (owned) rather than `&str`: Tauri builds the arguments from the JSON sent by the
// frontend, so the command receives values it owns.
//
// After every change, `state.sync.local_change()` tells the sync engine, which syncs 2 s after
// the last one (docs/04). It only sends a message: it never waits.

/// Burns the fuses first (docs/06), so a list never shows a note whose fuse has burnt out.
/// When that moved notes, the frontend is told as well: the open note may be one of them.
#[tauri::command]
pub async fn list_notes(
    app: AppHandle,
    state: State<'_, AppState>,
    filter: ListFilter,
) -> Result<Vec<NoteSummary>> {
    let (summaries, changed) = {
        let mut conn = state.lock_db()?;
        let changed = ephemeral::run_maintenance_or_log(&mut conn, now_ms());
        (notes::list(&conn, filter)?, changed)
    }; // The database lock is released here, before the event.
    if changed {
        watcher::notify_notes_changed(&app);
        state.sync.local_change();
    }
    Ok(summaries)
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
    let note = {
        let conn = state.lock_db()?;
        if fused == Some(true) {
            let delay_hours = settings::load(&conn)?.fuse_delay_hours;
            notes::create_fused(&conn, kind, delay_hours, now_ms())?
        } else {
            notes::create(&conn, kind, now_ms())?
        }
    };
    state.sync.local_change();
    Ok(note)
}

/// Lights or puts out the fuse of a note (docs/06). A fuse is lit with the delay of the settings.
///
/// A fuse that has burnt out can no longer be put out: the note explodes first and comes back
/// in the trash, without an error (docs/06, "la fenêtre d'une minute").
#[tauri::command]
pub async fn set_ephemeral(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Note> {
    let now = now_ms();
    let (result, changed) = {
        let mut conn = state.lock_db()?;
        let before = ephemeral::maintenance_before_action(&mut conn, &id, now)?;
        let result = if before.exploded {
            notes::get(&conn, &id)
        } else {
            settings::load(&conn).and_then(|settings| {
                notes::set_ephemeral(&conn, &id, enabled, settings.fuse_delay_hours, now)
            })
        };
        (result, before.changed)
    };
    after_action(&app, &state, changed, result.is_ok());
    result
}

/// Tells the frontend and the sync after an action preceded by a maintenance. The maintenance
/// may have changed notes even when the action then failed (the note had just been purged).
fn after_action(app: &AppHandle, state: &AppState, changed: bool, done: bool) {
    if changed {
        watcher::notify_notes_changed(app);
    }
    if changed || done {
        state.sync.local_change();
    }
}

#[tauri::command]
pub async fn update_note(state: State<'_, AppState>, id: String, patch: NotePatch) -> Result<Note> {
    let note = notes::update(&*state.lock_db()?, &id, patch, now_ms())?;
    state.sync.local_change();
    Ok(note)
}

/// A note whose fuse has just burnt out explodes first: it is then in the trash already, which
/// is what was asked (docs/06, "la fenêtre d'une minute").
#[tauri::command]
pub async fn trash_note(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    let now = now_ms();
    let (result, changed) = {
        let mut conn = state.lock_db()?;
        let before = ephemeral::maintenance_before_action(&mut conn, &id, now)?;
        let result = if before.exploded {
            Ok(())
        } else {
            notes::trash(&conn, &id, now)
        };
        (result, before.changed)
    };
    after_action(&app, &state, changed, result.is_ok());
    result
}

#[tauri::command]
pub async fn restore_note(state: State<'_, AppState>, id: String) -> Result<()> {
    notes::restore(&*state.lock_db()?, &id, now_ms())?;
    state.sync.local_change();
    Ok(())
}

#[tauri::command]
pub async fn delete_note_forever(state: State<'_, AppState>, id: String) -> Result<()> {
    notes::delete_forever(&*state.lock_db()?, &id, now_ms())?;
    state.sync.local_change();
    Ok(())
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
    let count = notes::empty_trash(&mut *state.lock_db()?, now_ms())?;
    state.sync.local_change();
    Ok(count)
}
