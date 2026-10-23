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

    /// A request to the server while this device is logged out (devices, invitations).
    #[error("this device is not connected to a server")]
    NotConnected,

    /// The server could not be reached: no network, server down, timeout (docs/04).
    #[error("server unreachable: {0}")]
    Network(String),

    /// The server answered with an error. `code` is its stable error code (`invalid_credentials`,
    /// `unauthorized`, `rate_limited`…, see server/app/Http/Controllers/Api), or `server` when
    /// it gave none (an Apache error page, a crash).
    #[error("server error {status} {code}: {message}")]
    Api {
        status: u16,
        code: String,
        message: String,
        /// Seconds to wait before trying again (429 answers).
        retry_after: Option<u64>,
    },
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
            Error::NotConnected => "not_connected",
            Error::Network(_) => "network",
            Error::Api { code, .. } => api_kind(code),
        }
    }
}

/// The server's error codes the frontend knows, as `kind` (a `&'static str`: the code comes
/// from the network, so it is matched against the known ones). Any other code is `server`.
fn api_kind(code: &str) -> &'static str {
    const KNOWN: [&str; 12] = [
        "invalid_credentials",
        "invalid_invitation",
        "invalid_email",
        "email_taken",
        "weak_password",
        "too_many_invitations",
        "unauthorized",
        "rate_limited",
        "not_meche_server",
        "invalid_input",
        "not_found",
        // The server refused a note sent by this device: retrying will not help.
        "invalid_change",
    ];
    KNOWN
        .into_iter()
        .find(|known| *known == code)
        .unwrap_or("server")
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
    fn server_errors_keep_the_known_codes_only() {
        let api = |code: &str| Error::Api {
            status: 422,
            code: code.to_string(),
            message: String::new(),
            retry_after: None,
        };
        assert_eq!(api("email_taken").kind(), "email_taken");
        assert_eq!(api("something_new").kind(), "server");
        assert_eq!(Error::Network("timeout".to_string()).kind(), "network");
    }

    #[test]
    fn serializes_kind_and_message_for_the_frontend() {
        let error = Error::Io(std::io::Error::other("disk full"));
        let json = serde_json::to_value(&error).unwrap();
        assert_eq!(json["kind"], "io");
        assert_eq!(json["message"], "file system error: disk full");
    }
}
