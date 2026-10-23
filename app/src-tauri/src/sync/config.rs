//! Sync settings, stored in the `settings` table (docs/03): the server, this device's token,
//! the cursor… The token never leaves Rust: it is in none of the structures sent to the
//! frontend.

use reqwest::Url;
use rusqlite::Connection;

use crate::db::settings::{read, write};
use crate::error::{Error, Result};

const SERVER_URL_KEY: &str = "server_url";
const API_TOKEN_KEY: &str = "api_token";
const ACCOUNT_EMAIL_KEY: &str = "account_email";
const DEVICE_NAME_KEY: &str = "device_name";
const CURSOR_KEY: &str = "sync_cursor";
const LAST_SYNC_KEY: &str = "last_sync_at";
const SYNC_ID_KEY: &str = "server_sync_id";

/// Where and how this device syncs.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncConfig {
    /// Base address of the server, without `/api` (e.g. `https://meche.pierrebultez.com`).
    pub server_url: Option<String>,
    /// This device's token; `None` when logged out.
    pub token: Option<String>,
    /// The account. Kept after a logout, to warn before syncing this device with another one.
    pub email: Option<String>,
    pub device_name: Option<String>,
    /// The highest revision received from the server (docs/04).
    pub cursor: i64,
    pub last_sync_at: Option<i64>,
    /// Identity of the account's sync history on the server (docs/04).
    pub sync_id: Option<String>,
}

impl SyncConfig {
    /// The server and the token, when this device is logged in.
    pub fn session(&self) -> Option<(&str, &str)> {
        Some((self.server_url.as_deref()?, self.token.as_deref()?))
    }
}

pub fn load(conn: &Connection) -> Result<SyncConfig> {
    Ok(SyncConfig {
        server_url: read(conn, SERVER_URL_KEY)?,
        token: read(conn, API_TOKEN_KEY)?,
        email: read(conn, ACCOUNT_EMAIL_KEY)?,
        device_name: read(conn, DEVICE_NAME_KEY)?,
        cursor: read(conn, CURSOR_KEY)?.unwrap_or(0),
        last_sync_at: read(conn, LAST_SYNC_KEY)?,
        sync_id: read(conn, SYNC_ID_KEY)?,
    })
}

/// Remembers a successful login (inside the caller's transaction).
pub fn save_login(
    conn: &Connection,
    server_url: &str,
    token: &str,
    email: &str,
    device_name: &str,
    sync_id: &str,
) -> Result<()> {
    write(conn, SERVER_URL_KEY, &server_url)?;
    write(conn, API_TOKEN_KEY, &token)?;
    write(conn, ACCOUNT_EMAIL_KEY, &email)?;
    write(conn, DEVICE_NAME_KEY, &device_name)?;
    write(conn, SYNC_ID_KEY, &sync_id)
}

/// Logged out: the token is forgotten; the server, the account and the cursor are kept, so
/// logging in again to the same account goes on where it stopped.
pub fn forget_token(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", [API_TOKEN_KEY])?;
    Ok(())
}

pub fn save_cursor(conn: &Connection, cursor: i64) -> Result<()> {
    write(conn, CURSOR_KEY, &cursor)
}

pub fn save_last_sync(conn: &Connection, at: i64) -> Result<()> {
    write(conn, LAST_SYNC_KEY, &at)
}

pub fn save_sync_id(conn: &Connection, sync_id: &str) -> Result<()> {
    write(conn, SYNC_ID_KEY, &sync_id)
}

/// The address typed by the user, as the base of the API: `https://` added when missing,
/// `/api` and the final `/` removed. HTTPS is required (docs/02), except on this computer
/// (`localhost`, `127.0.0.1`), for development.
pub fn normalize_server_url(typed: &str) -> Result<String> {
    let typed = typed.trim();
    let invalid = || Error::InvalidInput(format!("not a server address: {typed}"));
    if typed.is_empty() {
        return Err(invalid());
    }
    let with_scheme = if typed.contains("://") {
        typed.to_string()
    } else {
        format!("https://{typed}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| invalid())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    let secure = url.scheme() == "https" || (url.scheme() == "http" && local);
    if !secure || url.host_str().is_none() || url.query().is_some() || url.fragment().is_some() {
        return Err(invalid());
    }
    let mut base = url.as_str().trim_end_matches('/').to_string();
    if let Some(without_api) = base.strip_suffix("/api") {
        base = without_api.to_string();
    }
    Ok(base)
}

/// Name given to this device in the account's device list, until the user chooses another
/// one: the computer's name.
pub fn default_device_name() -> String {
    // `std::env::var` reads an environment variable; `ok()` turns "missing" into None.
    let name = if cfg!(windows) {
        std::env::var("COMPUTERNAME").ok()
    } else {
        std::fs::read_to_string("/etc/hostname").ok()
    };
    name.map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Mèche".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn remembers_a_login_and_forgets_only_the_token_at_logout() {
        let conn = open_in_memory().unwrap();
        assert_eq!(load(&conn).unwrap(), SyncConfig::default());

        save_login(
            &conn,
            "https://m.example",
            "1|meche_x",
            "p@example.com",
            "PC",
            "s1",
        )
        .unwrap();
        save_cursor(&conn, 42).unwrap();
        let config = load(&conn).unwrap();
        assert_eq!(config.session(), Some(("https://m.example", "1|meche_x")));
        assert_eq!(config.cursor, 42);

        forget_token(&conn).unwrap();
        let config = load(&conn).unwrap();
        assert_eq!(config.session(), None);
        assert_eq!(config.email.as_deref(), Some("p@example.com"));
        assert_eq!(config.sync_id.as_deref(), Some("s1"));
        assert_eq!(config.cursor, 42);
    }

    #[test]
    fn server_addresses_are_normalized() {
        let ok = |typed: &str| normalize_server_url(typed).unwrap();
        assert_eq!(
            ok("meche.pierrebultez.com"),
            "https://meche.pierrebultez.com"
        );
        assert_eq!(
            ok(" https://meche.pierrebultez.com/api/ "),
            "https://meche.pierrebultez.com"
        );
        assert_eq!(
            ok("https://example.com/notes/"),
            "https://example.com/notes"
        );
        assert_eq!(ok("http://127.0.0.1:8000"), "http://127.0.0.1:8000");
        assert_eq!(ok("http://localhost:8000/api"), "http://localhost:8000");
        for refused in [
            "",
            "http://meche.pierrebultez.com",
            "ftp://example.com",
            "https://example.com/?a=1",
            "https://",
        ] {
            assert!(normalize_server_url(refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn the_default_device_name_is_never_empty() {
        assert!(!default_device_name().is_empty());
    }
}
