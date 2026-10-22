//! The error type of the Rust core.
//!
//! Every fallible function returns `Result<T>` (defined below), so the `?` operator can pass any
//! of these errors up to the Tauri command, which sends it to the frontend.

use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Everything that can go wrong in the Rust core.
///
/// `#[from]` (from the `thiserror` crate) lets `?` convert a library error into ours
/// automatically, e.g. a `rusqlite::Error` becomes `Error::Database`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("database migration error: {0}")]
    Migration(#[from] rusqlite_migration::Error),

    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid JSON data: {0}")]
    Json(#[from] serde_json::Error),

    #[error("note not found: {0}")]
    NotFound(String),

    /// A request the frontend should never send (too long title, wrong state…).
    #[error("invalid request: {0}")]
    InvalidInput(String),

    /// A command panicked while it held the database lock (see `AppState::lock_db`).
    #[error("the database is unavailable after an internal error")]
    DatabaseLockPoisoned,
}

/// Shorthand: `Result<Settings>` means `std::result::Result<Settings, Error>`.
pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// Short, stable code that the frontend can use to choose a French message.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Database(_) => "database",
            Error::Migration(_) => "migration",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
            Error::NotFound(_) => "not_found",
            Error::InvalidInput(_) => "invalid_input",
            Error::DatabaseLockPoisoned => "database_lock",
        }
    }
}

/// Tauri sends a command's error to the frontend as JSON, so it must be serializable.
/// The frontend receives `{ "kind": "database", "message": "database error: …" }`.
impl Serialize for Error {
    // `S` is "any serializer": serde calls this with its JSON serializer. This generic signature
    // is imposed by the `Serialize` trait.
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("Error", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_kind_and_message_for_the_frontend() {
        let error = Error::Io(std::io::Error::other("disk full"));
        let json = serde_json::to_value(&error).unwrap();
        assert_eq!(json["kind"], "io");
        assert_eq!(json["message"], "file system error: disk full");
    }
}
