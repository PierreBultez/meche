//! Settings commands: `invoke("get_settings")` and `invoke("set_settings", { patch })`.

use tauri::State;

use crate::AppState;
use crate::db::settings::{self, Settings, SettingsPatch};
use crate::error::Result;

// Commands are `async` so Tauri runs them off the main thread: the window never freezes,
// even if a query is slow. The body does not `.await` anything, so the database lock is
// never held while waiting.

/// Returns the current settings.
#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings> {
    let conn = state.lock_db()?;
    settings::load(&conn)
}

/// Saves the fields present in `patch` and returns the updated settings.
#[tauri::command]
pub async fn set_settings(state: State<'_, AppState>, patch: SettingsPatch) -> Result<Settings> {
    let mut conn = state.lock_db()?;
    settings::apply_patch(&mut conn, patch)
}
