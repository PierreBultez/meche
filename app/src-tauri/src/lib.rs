//! Mèche's Rust core.
//!
//! The frontend never touches the disk or the network: it calls the commands registered here,
//! and Rust is the only owner of the data (docs/02-architecture.md, decision D3).

mod commands;
mod db;
mod error;

use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::Manager;

use crate::error::{Error, Result};

/// State shared by every command (Tauri hands it to them, see `app.manage` below).
pub struct AppState {
    /// The single SQLite connection. Commands can run on several threads at the same time,
    /// so the connection is wrapped in a `Mutex`: one command uses it at a time.
    pub db: Mutex<Connection>,
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

// Entry point shared by desktop (`main.rs`) and mobile (Android) builds.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Private data folder of the app, e.g. ~/.local/share/fr.pierrebultez.meche on Linux.
            let data_dir = app.path().app_data_dir()?;
            let conn = db::open_in_dir(&data_dir)?;
            // From now on Tauri owns the state; commands borrow it with `State<AppState>`.
            app.manage(AppState {
                db: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::set_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mèche");
}
