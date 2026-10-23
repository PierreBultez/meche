//! Background thread that burns the fuses while the app is open (docs/06): every minute it runs
//! the maintenance, then tells the frontend with the `notes-changed` event when notes changed.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;
use crate::error::Result;
use crate::time::now_ms;

/// Event sent to the frontend when notes changed without it asking (docs/02): it then reloads
/// the list and the open note.
pub const NOTES_CHANGED: &str = "notes-changed";

/// Fuses last at least one hour: checking every minute is precise enough.
const INTERVAL: Duration = Duration::from_secs(60);

/// Starts the thread. It runs until the app quits.
///
/// A thread is a second line of execution: it sleeps and works on its own, while the commands
/// keep answering the frontend. `move` gives the closure its own `app` handle (an `AppHandle` is
/// a cheap reference to the running app, made to be sent to other threads).
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(INTERVAL);
            if let Err(error) = maintain(&app) {
                // Nothing to show: the next run tries again.
                eprintln!("fuse maintenance failed: {error}");
            }
        }
    });
}

/// One run of the maintenance, then the event if notes changed.
fn maintain(app: &AppHandle) -> Result<()> {
    // The thread shares the database with the commands: it takes the same lock, only for the
    // time of the maintenance (a few milliseconds), then gives it back.
    let state = app.state::<AppState>();
    let changed = {
        let mut conn = state.lock_db()?;
        super::run_maintenance(&mut conn, now_ms())?
    }; // The lock is released here, before the event is sent.
    if changed {
        notify_notes_changed(app);
    }
    Ok(())
}

/// Tells the frontend that notes changed. A lost event is not an error: the next action of the
/// user reloads the list anyway.
pub fn notify_notes_changed(app: &AppHandle) {
    if let Err(error) = app.emit(NOTES_CHANGED, ()) {
        eprintln!("could not send {NOTES_CHANGED}: {error}");
    }
}
