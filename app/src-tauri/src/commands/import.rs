//! Import commands (docs/07): writing the notes converted from a Standard Notes backup, and the
//! triage screen that follows.

use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::AppState;
use crate::backup::{self, Backup};
use crate::db::import::{self, ImportResult, ImportedNote};
use crate::db::settings;
use crate::db::triage::{self, Decision, Triage, TriageUndo};
use crate::ephemeral::{self, watcher};
use crate::error::{Error, Result};
use crate::time::now_ms;

/// Opens the system's file chooser, then reads the chosen backup. `None` when the chooser was
/// closed without a file.
///
/// Rust opens the chooser itself: the frontend never handles a path, and has no permission to
/// read files. `window` is the window that called the command (Tauri fills it in): the chooser
/// opens on top of it.
#[tauri::command]
pub async fn read_import_file(app: AppHandle, window: WebviewWindow) -> Result<Option<Backup>> {
    // The chooser answers through a callback, on another thread; the channel brings the answer
    // back here. `oneshot`: a channel for exactly one value.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let chooser = app
        .dialog()
        .file()
        .set_title("Importer depuis Standard Notes")
        .add_filter("Sauvegarde Standard Notes", &["zip", "txt", "json"]);
    // A parent window exists on desktop only (on Android, the chooser takes the whole screen).
    #[cfg(desktop)]
    let chooser = chooser.set_parent(&window);
    // `window` is not used on Android: say so, or the compiler warns there.
    #[cfg(not(desktop))]
    let _ = &window;
    chooser.pick_file(move |file| {
        // `let _ =`: the receiver is only gone if the command was dropped meanwhile.
        let _ = sender.send(file);
    });
    let Some(file) = receiver.await.ok().flatten() else {
        return Ok(None);
    };
    // Android gives `content://` addresses, which have no path (phase 5).
    let path = file
        .into_path()
        .map_err(|_| Error::Backup("backup_location"))?;
    // Reading and checking a big backup takes a moment: on a thread made for blocking work,
    // so the async threads (the sync engine…) keep running.
    tauri::async_runtime::spawn_blocking(move || backup::read(&path).map(Some))
        .await
        .map_err(|error| Error::Io(std::io::Error::other(error.to_string())))?
}

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

/// « Annuler » : takes back a decision returned by `triage_decide`. Fuses burn first: a fuse
/// lit by « Mèche » that has just burnt out cannot be put out any more (docs/06), the undo is
/// then refused (`invalid_input`, the note changed).
#[tauri::command]
pub async fn triage_undo(
    app: AppHandle,
    state: State<'_, AppState>,
    undo: TriageUndo,
) -> Result<()> {
    let (result, burnt) = {
        let mut conn = state.lock_db()?;
        let burnt = ephemeral::run_maintenance_or_log(&mut conn, now_ms());
        (triage::undo(&mut conn, &undo), burnt)
    };
    if burnt {
        watcher::notify_notes_changed(&app);
    }
    if burnt || (result.is_ok() && undo.changed) {
        state.sync.local_change();
    }
    result
}

/// Closes the final screen of the triage.
#[tauri::command]
pub async fn finish_triage(state: State<'_, AppState>) -> Result<()> {
    triage::finish(&*state.lock_db()?)
}
