//! Mèche's Rust core.
//!
//! The frontend never touches the disk or the network: it calls the commands registered here,
//! and Rust is the only owner of the data (docs/02-architecture.md, decision D3).

mod backup;
mod commands;
mod db;
mod ephemeral;
mod error;
mod sync;
mod time;

use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::Connection;
use tauri::Manager;

use crate::error::{Error, Result};
use crate::sync::engine::SyncHandle;

/// State shared by every command (Tauri hands it to them, see `app.manage` below).
pub struct AppState {
    /// The single SQLite connection. Commands can run on several threads at the same time,
    /// so the connection is wrapped in a `Mutex`: one command uses it at a time. The fuse
    /// watcher and the sync engine share it too.
    pub db: Mutex<Connection>,
    /// Talks to the sync engine (sync/engine.rs).
    pub sync: SyncHandle,
}

impl AppState {
    /// Waits for the database to be free and locks it for the current command.
    ///
    /// The returned guard gives access to the `Connection` and unlocks it automatically when it
    /// goes out of scope (at the end of the command). `'_` says the guard borrows `self`: it
    /// cannot outlive the state it comes from.
    pub fn lock_db(&self) -> Result<MutexGuard<'_, Connection>> {
        // `lock` only fails if another command panicked while holding the lock ("poisoned").
        self.db.lock().map_err(|_| Error::DatabaseLockPoisoned)
    }
}

/// The main window starts hidden (tauri.conf.json) and the frontend shows it once the right theme
/// is applied. Safety net: if the frontend has not done it after a few seconds (a JavaScript
/// error, for instance), show the window anyway so the app never stays invisible.
fn show_window_if_frontend_fails(app: &tauri::App) {
    if let Some(window) = app.get_webview_window("main") {
        // `move` gives the thread its own `window` handle: the closure takes ownership of it,
        // so it stays valid after this function returns.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(3));
            if !window.is_visible().unwrap_or(true) {
                // `let _ =` ignores the result: there is nothing more to do if this fails.
                let _ = window.show();
            }
        });
    }
}

// Entry point shared by desktop (`main.rs`) and mobile (Android) builds.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Opens links in the system browser (Ctrl+click in a note, docs/05).
        .plugin(tauri_plugin_opener::init())
        // Native file chooser of the import (docs/07). Only Rust opens it: the frontend has no
        // permission for the plugin's own commands (capabilities/default.json).
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Private data folder of the app, e.g. ~/.local/share/fr.pierrebultez.meche on Linux.
            let data_dir = app.path().app_data_dir()?;
            let mut conn = db::open_in_dir(&data_dir)?;
            // Notes whose fuse burnt out while the app was closed go to the trash (and the trash
            // is purged) before the first list is shown.
            // Best effort: the app opens even if this fails.
            ephemeral::run_maintenance_or_log(&mut conn, time::now_ms());
            let (sync, engine) =
                sync::engine::create(sync::api::Api::new(), &sync::config::load(&conn)?);
            // From now on Tauri owns the state; commands borrow it with `State<AppState>`.
            app.manage(AppState {
                db: Mutex::new(conn),
                sync,
            });
            // Then once a minute while the app is open. `app.handle()` is the running app; the
            // thread gets its own copy (`clone`) because it outlives this function.
            ephemeral::watcher::spawn(app.handle().clone());
            // The sync engine: a tokio task (docs/04). It syncs at once when an account is
            // connected.
            engine.spawn(app.handle().clone());
            show_window_if_frontend_fails(app);
            Ok(())
        })
        // Coming back to the window syncs at once (docs/04). `try_state`: the window may get
        // the focus before the state exists.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event
                && let Some(state) = window.try_state::<AppState>()
            {
                state.sync.focus();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::notes::list_notes,
            commands::notes::get_note,
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::set_ephemeral,
            commands::notes::trash_note,
            commands::notes::restore_note,
            commands::notes::delete_note_forever,
            commands::notes::empty_trash,
            commands::notes::search,
            commands::import::read_import_file,
            commands::import::import_notes,
            commands::import::get_triage,
            commands::import::triage_decide,
            commands::import::triage_undo,
            commands::import::finish_triage,
            commands::sync::get_sync_status,
            commands::sync::check_server,
            commands::sync::login,
            commands::sync::register,
            commands::sync::logout,
            commands::sync::sync_now,
            commands::sync::list_devices,
            commands::sync::revoke_device,
            commands::sync::list_invitations,
            commands::sync::create_invitation,
            commands::sync::delete_invitation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mèche");
}
