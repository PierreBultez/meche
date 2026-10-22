//! Local settings, stored in the `settings` table as key / JSON value (docs/03).

use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::error::Result;

const THEME_KEY: &str = "theme";

/// Color theme chosen by the user. Stored as "system", "light" or "dark".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

/// Settings sent to the frontend. Secrets (like the future API token) never go in here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: Theme,
}

/// Partial update sent by the frontend: only the fields present are changed.
/// Unknown fields are refused, so a typo in the frontend fails loudly instead of being ignored.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
}

/// Reads all settings, with the default value for each missing one.
pub fn load(conn: &Connection) -> Result<Settings> {
    Ok(Settings {
        theme: read(conn, THEME_KEY)?.unwrap_or_default(),
    })
}

/// Saves the fields present in `patch` (all or nothing), then returns the updated settings.
pub fn apply_patch(conn: &mut Connection, patch: SettingsPatch) -> Result<Settings> {
    // A transaction needs exclusive access to the connection, hence `&mut Connection`.
    let tx = conn.transaction()?;
    if let Some(theme) = patch.theme {
        write(&tx, THEME_KEY, &theme)?;
    }
    tx.commit()?;
    load(conn)
}

/// Reads one setting and converts it from JSON to the expected type `T`.
///
/// `T` is generic so the same function works for every setting type (theme, URL, delays…).
/// Returns `None` if the key is missing or its value cannot be read (for instance a value
/// written by a newer version of Mèche): the caller then uses the default value.
fn read<T: DeserializeOwned>(conn: &Connection, key: &str) -> Result<Option<T>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?; // `optional()` turns "no row" into `None` instead of an error.
    Ok(raw.and_then(|json| serde_json::from_str(&json).ok()))
}

/// Writes one setting as JSON, replacing any previous value.
fn write<T: Serialize>(conn: &Connection, key: &str, value: &T) -> Result<()> {
    let json = serde_json::to_string(value)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![key, json],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn defaults_to_the_system_theme() {
        let conn = open_in_memory().unwrap();
        assert_eq!(load(&conn).unwrap().theme, Theme::System);
    }

    #[test]
    fn saves_and_reloads_the_theme() {
        let mut conn = open_in_memory().unwrap();
        let patch = SettingsPatch {
            theme: Some(Theme::Dark),
        };
        assert_eq!(apply_patch(&mut conn, patch).unwrap().theme, Theme::Dark);
        assert_eq!(load(&conn).unwrap().theme, Theme::Dark);

        // Stored as a JSON string, as documented in docs/03.
        let raw: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw, "\"dark\"");
    }

    #[test]
    fn an_empty_patch_changes_nothing() {
        let mut conn = open_in_memory().unwrap();
        let light = SettingsPatch {
            theme: Some(Theme::Light),
        };
        apply_patch(&mut conn, light).unwrap();
        let settings = apply_patch(&mut conn, SettingsPatch::default()).unwrap();
        assert_eq!(settings.theme, Theme::Light);
    }

    #[test]
    fn an_unreadable_value_falls_back_to_the_default() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', '\"sepia\"')",
            [],
        )
        .unwrap();
        assert_eq!(load(&conn).unwrap().theme, Theme::System);
    }

    #[test]
    fn uses_the_json_shape_expected_by_the_frontend() {
        let settings = Settings { theme: Theme::Dark };
        assert_eq!(
            serde_json::to_value(&settings).unwrap(),
            serde_json::json!({ "theme": "dark" })
        );

        let patch: SettingsPatch = serde_json::from_str(r#"{ "theme": "light" }"#).unwrap();
        assert_eq!(patch.theme, Some(Theme::Light));
        let typo = serde_json::from_str::<SettingsPatch>(r#"{ "theem": "light" }"#);
        assert!(typo.is_err());
    }
}
