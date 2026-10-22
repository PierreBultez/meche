//! Mèche's Rust core.
//!
//! The frontend never touches the disk or the network: it calls the commands registered here,
//! and Rust is the only owner of the data (docs/02-architecture.md, decision D3).

mod db;
mod error;

use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

/// State shared by every command (Tauri hands it to them, see `app.manage` below).
pub struct AppState {
    /// The single SQLite connection. Commands can run on several threads at the same time,
    /// so the connection is wrapped in a `Mutex`: one command uses it at a time.
    pub db: Mutex<Connection>,
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
        .run(tauri::generate_context!())
        .expect("error while running Mèche");
}
