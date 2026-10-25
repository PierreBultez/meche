//! Import commands (docs/07): writing the notes converted from a Standard Notes backup, and the
//! triage screen that follows.

use tauri::{AppHandle, State};

use crate::AppState;
use crate::db::import::{self, ImportResult, ImportedNote};
use crate::db::settings;
use crate::db::triage::{self, Decision, Triage, TriageUndo};
use crate::ephemeral::{self, watcher};
use crate::error::Result;
use crate::time::now_ms;

/// Writes the converted notes in one transaction; they leave for the server at the next sync.
#[tauri::command]
pub async fn import_notes(
    state: State<'_, AppState>,
    notes: Vec<ImportedNote>,
) -> Result<ImportResult> {
    let result = import::import_notes(&mut *state.lock_db()?, notes, now_ms())?;
    if result.imported > 0 {
        state.sync.local_change();
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_triage(state: State<'_, AppState>) -> Result<Triage> {
    triage::get(&mut *state.lock_db()?)
}

/// One of the four buttons of the triage screen. Fuses burn first, as for the fuse and trash
/// buttons of a note (docs/06, "la fenêtre d'une minute").
#[tauri::command]
pub async fn triage_decide(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    decision: Decision,
) -> Result<TriageUndo> {
    let now = now_ms();
    let (result, burnt) = {
        let mut conn = state.lock_db()?;
        let burnt = ephemeral::run_maintenance_or_log(&mut conn, now);
        let result = settings::load(&conn).and_then(|settings| {
            triage::decide(&mut conn, &id, decision, settings.fuse_delay_hours, now)
        });
        (result, burnt)
    }; // The database lock is released here, before the event.
    if burnt {
        watcher::notify_notes_changed(&app);
    }
    if burnt || result.as_ref().is_ok_and(|undo| undo.changed) {
        state.sync.local_change();
    }
    result
}

/// « Annuler » : takes back a decision returned by `triage_decide`.
#[tauri::command]
pub async fn triage_undo(state: State<'_, AppState>, undo: TriageUndo) -> Result<()> {
    triage::undo(&mut *state.lock_db()?, &undo)?;
    if undo.changed {
        state.sync.local_change();
    }
    Ok(())
}

/// Closes the final screen of the triage.
#[tauri::command]
pub async fn finish_triage(state: State<'_, AppState>) -> Result<()> {
    triage::finish(&*state.lock_db()?)
}
