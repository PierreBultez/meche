//! Local settings, stored in the `settings` table as key / JSON value (docs/03).

use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const THEME_KEY: &str = "theme";
const LIST_WIDTH_KEY: &str = "list_width";
const CODE_LINE_WRAP_KEY: &str = "code_line_wrap";
const FUSE_DELAY_KEY: &str = "fuse_delay_hours";

/// Width of the note list column in pixels (docs/08: 280 px, resizable).
pub const DEFAULT_LIST_WIDTH: u32 = 280;
pub const MIN_LIST_WIDTH: u32 = 220;
pub const MAX_LIST_WIDTH: u32 = 520;

/// Delays offered for the fuse of a note, in hours (docs/06): 1 h, 24 h, 3, 7 and 30 days.
pub const FUSE_DELAYS_HOURS: [i64; 5] = [1, 24, 72, 168, 720];
pub const DEFAULT_FUSE_DELAY_HOURS: i64 = 168;

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
    pub list_width: u32,
    /// Wrap long lines in code notes (off by default, docs/05).
    pub code_line_wrap: bool,
    /// Delay of the fuses lit from now on (one of `FUSE_DELAYS_HOURS`). A fuse keeps the delay
    /// it was lit with: changing this setting does not touch the notes already burning.
    pub fuse_delay_hours: i64,
}

/// Partial update sent by the frontend: only the fields present are changed.
/// Unknown fields are refused, so a typo in the frontend fails loudly instead of being ignored.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub list_width: Option<u32>,
    pub code_line_wrap: Option<bool>,
    pub fuse_delay_hours: Option<i64>,
}

/// Reads all settings, with the default value for each missing one.
pub fn load(conn: &Connection) -> Result<Settings> {
    Ok(Settings {
        theme: read(conn, THEME_KEY)?.unwrap_or_default(),
        list_width: read(conn, LIST_WIDTH_KEY)?
            .unwrap_or(DEFAULT_LIST_WIDTH)
            .clamp(MIN_LIST_WIDTH, MAX_LIST_WIDTH),
        code_line_wrap: read(conn, CODE_LINE_WRAP_KEY)?.unwrap_or(false),
        fuse_delay_hours: read(conn, FUSE_DELAY_KEY)?
            .filter(|hours| FUSE_DELAYS_HOURS.contains(hours))
            .unwrap_or(DEFAULT_FUSE_DELAY_HOURS),
    })
}

/// Saves the fields present in `patch` (all or nothing), then returns the updated settings.
pub fn apply_patch(conn: &mut Connection, patch: SettingsPatch) -> Result<Settings> {
    if let Some(hours) = patch.fuse_delay_hours
        && !FUSE_DELAYS_HOURS.contains(&hours)
    {
        return Err(Error::InvalidInput(format!(
            "{hours} h is not one of the fuse delays"
        )));
    }
    // A transaction needs exclusive access to the connection, hence `&mut Connection`.
    let tx = conn.transaction()?;
    if let Some(theme) = patch.theme {
        write(&tx, THEME_KEY, &theme)?;
    }
    if let Some(width) = patch.list_width {
        write(
            &tx,
            LIST_WIDTH_KEY,
            &width.clamp(MIN_LIST_WIDTH, MAX_LIST_WIDTH),
        )?;
    }
    if let Some(wrap) = patch.code_line_wrap {
        write(&tx, CODE_LINE_WRAP_KEY, &wrap)?;
    }
    if let Some(hours) = patch.fuse_delay_hours {
        write(&tx, FUSE_DELAY_KEY, &hours)?;
    }
    tx.commit()?;
    load(conn)
}

/// Reads one setting and converts it from JSON to the expected type `T`.
///
/// `T` is generic so the same function works for every setting type (theme, URL, delays…).
/// Returns `None` if the key is missing or its value cannot be read (for instance a value
/// written by a newer version of Mèche): the caller then uses the default value.
pub(crate) fn read<T: DeserializeOwned>(conn: &Connection, key: &str) -> Result<Option<T>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?; // `optional()` turns "no row" into `None` instead of an error.
    Ok(raw.and_then(|json| serde_json::from_str(&json).ok()))
}

/// Writes one setting as JSON, replacing any previous value.
pub(crate) fn write<T: Serialize>(conn: &Connection, key: &str, value: &T) -> Result<()> {
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
            ..SettingsPatch::default()
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
            ..SettingsPatch::default()
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
        let settings = Settings {
            theme: Theme::Dark,
            list_width: 300,
            code_line_wrap: true,
            fuse_delay_hours: 24,
        };
        assert_eq!(
            serde_json::to_value(&settings).unwrap(),
            serde_json::json!({
                "theme": "dark",
                "listWidth": 300,
                "codeLineWrap": true,
                "fuseDelayHours": 24
            })
        );

        let patch: SettingsPatch = serde_json::from_str(r#"{ "theme": "light" }"#).unwrap();
        assert_eq!(patch.theme, Some(Theme::Light));
        let typo = serde_json::from_str::<SettingsPatch>(r#"{ "theem": "light" }"#);
        assert!(typo.is_err());
    }

    #[test]
    fn list_width_and_code_wrapping_have_defaults_and_persist() {
        let mut conn = open_in_memory().unwrap();
        let defaults = load(&conn).unwrap();
        assert_eq!(defaults.list_width, DEFAULT_LIST_WIDTH);
        assert!(!defaults.code_line_wrap);

        let patch = SettingsPatch {
            list_width: Some(333),
            code_line_wrap: Some(true),
            ..SettingsPatch::default()
        };
        let saved = apply_patch(&mut conn, patch).unwrap();
        assert_eq!((saved.list_width, saved.code_line_wrap), (333, true));
        assert_eq!(saved.theme, Theme::System);
    }

    #[test]
    fn list_width_stays_within_bounds() {
        let mut conn = open_in_memory().unwrap();
        let too_wide = SettingsPatch {
            list_width: Some(5_000),
            ..SettingsPatch::default()
        };
        assert_eq!(
            apply_patch(&mut conn, too_wide).unwrap().list_width,
            MAX_LIST_WIDTH
        );
        let too_narrow = SettingsPatch {
            list_width: Some(10),
            ..SettingsPatch::default()
        };
        assert_eq!(
            apply_patch(&mut conn, too_narrow).unwrap().list_width,
            MIN_LIST_WIDTH
        );
    }

    #[test]
    fn the_fuse_delay_defaults_to_seven_days_and_only_takes_the_offered_delays() {
        let mut conn = open_in_memory().unwrap();
        assert_eq!(load(&conn).unwrap().fuse_delay_hours, 168);

        for hours in FUSE_DELAYS_HOURS {
            let patch = SettingsPatch {
                fuse_delay_hours: Some(hours),
                ..SettingsPatch::default()
            };
            assert_eq!(
                apply_patch(&mut conn, patch).unwrap().fuse_delay_hours,
                hours
            );
        }
        for hours in [0, -1, 2, 100_000] {
            let patch = SettingsPatch {
                fuse_delay_hours: Some(hours),
                ..SettingsPatch::default()
            };
            assert!(matches!(
                apply_patch(&mut conn, patch),
                Err(Error::InvalidInput(_))
            ));
        }
        // A refused patch writes nothing, not even its other fields.
        let mixed = SettingsPatch {
            theme: Some(Theme::Dark),
            fuse_delay_hours: Some(5),
            ..SettingsPatch::default()
        };
        assert!(apply_patch(&mut conn, mixed).is_err());
        assert_eq!(load(&conn).unwrap().theme, Theme::System);
        assert_eq!(load(&conn).unwrap().fuse_delay_hours, 720);
    }

    #[test]
    fn an_unknown_stored_fuse_delay_falls_back_to_the_default() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('fuse_delay_hours', '5')",
            [],
        )
        .unwrap();
        assert_eq!(
            load(&conn).unwrap().fuse_delay_hours,
            DEFAULT_FUSE_DELAY_HOURS
        );
    }
}
