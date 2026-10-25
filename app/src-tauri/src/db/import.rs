//! Import of notes converted from a Standard Notes backup (docs/07).
//!
//! The frontend converts the backup (Lexical, HTML, checklists… → Markdown, app/src/import/);
//! Rust checks every note, then writes them all in one transaction: either every note is
//! imported, or none. The imported notes wait for the triage (`import_triage`) and are sent to
//! the server at the next sync (`dirty = 1`).

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::db::notes::{
    self, MAX_CODE_LANGUAGE_CHARS, MAX_CONTENT_BYTES, MAX_TITLE_CHARS, NoteColor, NoteKind,
};
use crate::db::triage;
use crate::error::{Error, Result};

/// Longest id accepted from a backup (a Standard Notes uuid has 36 characters).
const MAX_SOURCE_ID_CHARS: usize = 100;

/// A note converted by the frontend, ready to be written.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportedNote {
    /// Its id in the backup (the Standard Notes uuid). It becomes the note's id when it is a
    /// valid UUID, and is remembered so that importing the same backup again skips the note.
    pub source_id: String,
    pub title: String,
    pub content: String,
    pub kind: NoteKind,
    /// For a code note; ignored for a rich note.
    pub code_language: Option<String>,
    pub pinned: bool,
    /// Milliseconds, like every date (docs/03).
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Notes written.
    pub imported: usize,
    /// Notes skipped: imported before (even if deleted since), or already in Mèche.
    pub already_imported: usize,
}

/// Imports `notes` in one transaction and adds them to the triage queue, the oldest first.
///
/// `notes: Vec<ImportedNote>` is taken by value (owned): the list can be sorted in place, and
/// each note is moved into `insert` once written, instead of being cloned.
pub fn import_notes(
    conn: &mut Connection,
    mut notes: Vec<ImportedNote>,
    now: i64,
) -> Result<ImportResult> {
    for (index, note) in notes.iter().enumerate() {
        check(note).map_err(|problem| {
            // The index and the field only: a note's text never goes into an error message.
            Error::InvalidInput(format!("imported note {index}: {problem}"))
        })?;
    }
    // Oldest first: the triage shows them in this order (docs/07), and neighbours in the list
    // (sorted by date) get different colors. The id breaks ties, so the order never varies.
    // Colors follow this order only, whatever the notes already there or the time of the
    // import (the dates as written in the backup, not brought back to now): importing the same
    // backup on two devices before a sync gives the same notes, not conflicts.
    notes.sort_by(|a, b| (a.updated_at, &a.source_id).cmp(&(b.updated_at, &b.source_id)));

    let tx = conn.transaction()?;
    let mut position = triage::next_position(&tx)?;
    let mut result = ImportResult {
        imported: 0,
        already_imported: 0,
    };
    // `enumerate` gives each note its index in the sorted list, skipped notes included.
    for (index, note) in notes.into_iter().enumerate() {
        if already_imported(&tx, &note.source_id)? {
            result.already_imported += 1;
            continue;
        }
        let id = note_id_for(&note.source_id);
        remember(&tx, &note.source_id, &id, now)?;
        if note_exists(&tx, &id)? {
            result.already_imported += 1;
            continue;
        }
        if result.imported == 0 {
            // A new triage starts with the first new note: importing nothing new leaves the
            // counts of a finished triage (its final screen) as they are.
            triage::reset_if_finished(&tx)?;
        }
        insert(&tx, &id, note, notes::color_in_turn(index), now)?;
        tx.execute(
            "INSERT INTO import_triage (note_id, position) VALUES (?1, ?2)",
            params![id, position],
        )?;
        position += 1;
        result.imported += 1;
    }
    tx.commit()?;
    Ok(result)
}

/// Why `note` cannot be imported, if it cannot. Texts are measured like `update_note` does:
/// the title in characters, the content in bytes (docs/03, "Limites").
fn check(note: &ImportedNote) -> std::result::Result<(), String> {
    let source_chars = note.source_id.chars().count();
    if source_chars == 0 || source_chars > MAX_SOURCE_ID_CHARS {
        return Err("sourceId is empty or too long".to_string());
    }
    if note.title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("title is longer than {MAX_TITLE_CHARS} characters"));
    }
    if note.content.len() > MAX_CONTENT_BYTES {
        return Err("content is larger than 2 MB".to_string());
    }
    if let Some(language) = &note.code_language
        && language.chars().count() > MAX_CODE_LANGUAGE_CHARS
    {
        return Err(format!(
            "codeLanguage is longer than {MAX_CODE_LANGUAGE_CHARS} characters"
        ));
    }
    if note.created_at < 0 || note.updated_at < 0 {
        return Err("dates must be positive".to_string());
    }
    Ok(())
}

/// The id of the imported note: the backup's id when it is a UUID (written in lowercase, the
/// only form the server accepts), otherwise a new UUID v7.
fn note_id_for(source_id: &str) -> String {
    match uuid::Uuid::parse_str(source_id) {
        Ok(uuid) if !uuid.is_nil() => uuid.hyphenated().to_string(),
        _ => uuid::Uuid::now_v7().to_string(),
    }
}

fn already_imported(conn: &Connection, source_id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM imported_notes WHERE source_id = ?1)",
        [source_id],
        |row| row.get(0),
    )?)
}

/// Any row, a tombstone included: a note deleted on another device must not come back.
fn note_exists(conn: &Connection, id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM notes WHERE id = ?1)",
        [id],
        |row| row.get(0),
    )?)
}

fn remember(conn: &Connection, source_id: &str, note_id: &str, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO imported_notes (source_id, note_id, imported_at) VALUES (?1, ?2, ?3)",
        params![source_id, note_id, now],
    )?;
    Ok(())
}

/// Writes one imported note, never synced yet (`server_rev = 0`, `dirty = 1`).
/// A modification date in the future (a wrong clock in the backup) becomes now: such a note
/// would otherwise stay at the top of the list. The sync does not compare that date (docs/04);
/// the creation date, which it compares, is kept as written, so that two devices importing the
/// same backup at different times hold the same note.
fn insert(
    conn: &Connection,
    id: &str,
    note: ImportedNote,
    color: NoteColor,
    now: i64,
) -> Result<()> {
    let code_language = match note.kind {
        NoteKind::Code => Some(
            note.code_language
                .unwrap_or_else(|| "plaintext".to_string()),
        ),
        NoteKind::Rich => None,
    };
    conn.execute(
        "INSERT INTO notes (id, title, content, kind, code_language, pinned, color,
                            created_at, updated_at, server_rev, dirty)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 1)",
        params![
            id,
            note.title,
            note.content,
            note.kind,
            code_language,
            note.pinned,
            color,
            note.created_at,
            note.updated_at.min(now),
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::ListFilter;
    use crate::db::open_in_memory;
    use crate::db::triage::{self, Decision};

    const NOW: i64 = 1_800_000_000_000;

    fn imported(source_id: &str, updated_at: i64) -> ImportedNote {
        ImportedNote {
            source_id: source_id.to_string(),
            title: format!("Note {source_id}"),
            content: "- [ ] Lait\n- [x] Pain".to_string(),
            kind: NoteKind::Rich,
            code_language: None,
            pinned: false,
            created_at: 1_000,
            updated_at,
        }
    }

    const UUID_A: &str = "6f1c3a52-9d4e-4b8a-a1f0-2c3d4e5f6a7b";
    const UUID_B: &str = "0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a";
    const UUID_C: &str = "a0b1c2d3-e4f5-4a6b-8c7d-8e9fa0b1c2d3";

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn imports_the_notes_with_their_ids_dates_and_texts() {
        let mut conn = open_in_memory().unwrap();
        let mut code = imported(UUID_B, 2_000);
        code.kind = NoteKind::Code;
        code.code_language = Some("php".to_string());
        code.pinned = true;
        let result = import_notes(&mut conn, vec![imported(UUID_A, 3_000), code], NOW).unwrap();
        assert_eq!(
            result,
            ImportResult {
                imported: 2,
                already_imported: 0
            }
        );

        let note = notes::get(&conn, UUID_A).unwrap();
        assert_eq!(note.title, format!("Note {UUID_A}"));
        assert_eq!(note.content, "- [ ] Lait\n- [x] Pain");
        assert_eq!(
            (note.kind, note.code_language, note.pinned),
            (NoteKind::Rich, None, false)
        );
        assert_eq!((note.created_at, note.updated_at), (1_000, 3_000));
        assert_eq!((note.ephemeral_mode, note.trashed_at), (None, None));
        let note = notes::get(&conn, UUID_B).unwrap();
        assert_eq!(
            (note.kind, note.code_language.as_deref(), note.pinned),
            (NoteKind::Code, Some("php"), true)
        );
        // Both leave at the next sync, as new notes for the server.
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM notes WHERE dirty = 1 AND server_rev = 0"
            ),
            2
        );
        // The search index knows them.
        assert_eq!(crate::db::search::search(&conn, "pain").unwrap().len(), 2);
    }

    #[test]
    fn the_triage_shows_the_oldest_first() {
        let mut conn = open_in_memory().unwrap();
        let notes = vec![
            imported(UUID_A, 3_000),
            imported(UUID_B, 1_000),
            imported(UUID_C, 2_000),
        ];
        import_notes(&mut conn, notes, NOW).unwrap();
        let cards: Vec<String> = triage::get(&mut conn)
            .unwrap()
            .cards
            .into_iter()
            .map(|card| card.id)
            .collect();
        assert_eq!(cards, [UUID_B, UUID_C, UUID_A]);
    }

    #[test]
    fn colors_follow_the_order_of_the_backup() {
        let mut conn = open_in_memory().unwrap();
        let notes: Vec<ImportedNote> = (0..9)
            .map(|i| imported(&format!("note-{i}"), 1_000 + i))
            .collect();
        import_notes(&mut conn, notes, NOW).unwrap();
        let mut stmt = conn
            .prepare("SELECT color FROM notes ORDER BY updated_at")
            .unwrap();
        let colors: Vec<NoteColor> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        // The 8 colors in turn, in the order of new notes: neighbours always differ.
        let expected: Vec<NoteColor> = (0..9).map(notes::color_in_turn).collect();
        assert_eq!(colors, expected);
        for pair in colors.windows(2) {
            assert_ne!(pair[0], pair[1]);
        }
    }

    #[test]
    fn the_same_backup_gets_the_same_colors_on_any_device() {
        // Two devices, one already holding a note: importing the same backup on both before a
        // sync must give the same notes, or the sync would see conflicts (review, phase 4).
        let mut first = open_in_memory().unwrap();
        let mut second = open_in_memory().unwrap();
        notes::create(&second, NoteKind::Rich, 0).unwrap();
        let backup = || {
            vec![
                imported(UUID_A, 1_000),
                imported(UUID_B, 2_000),
                imported(UUID_C, 3_000),
            ]
        };
        import_notes(&mut first, backup(), NOW).unwrap();
        import_notes(&mut second, backup(), NOW).unwrap();
        for id in [UUID_A, UUID_B, UUID_C] {
            assert_eq!(
                notes::get(&first, id).unwrap().color,
                notes::get(&second, id).unwrap().color
            );
        }
    }

    #[test]
    fn the_same_backup_gives_the_same_notes_at_any_time() {
        // Dates later than the first import but earlier than the second (a wrong clock in the
        // backup): the second device, an hour later, must still give the same notes, or the
        // sync would see conflicts (review, phase 4).
        let mut first = open_in_memory().unwrap();
        let mut second = open_in_memory().unwrap();
        let backup = || {
            vec![
                imported(UUID_A, NOW + 900_000),
                ImportedNote {
                    created_at: NOW + 1_800_000,
                    ..imported(UUID_B, NOW + 1_800_000)
                },
            ]
        };
        import_notes(&mut first, backup(), NOW).unwrap();
        import_notes(&mut second, backup(), NOW + 3_600_000).unwrap();
        for id in [UUID_A, UUID_B] {
            let (one, two) = (
                notes::get(&first, id).unwrap(),
                notes::get(&second, id).unwrap(),
            );
            assert_eq!((one.color, one.created_at), (two.color, two.created_at));
        }
    }

    #[test]
    fn importing_nothing_new_keeps_the_counts_of_a_finished_triage() {
        let mut conn = open_in_memory().unwrap();
        import_notes(&mut conn, vec![imported(UUID_A, 1_000)], NOW).unwrap();
        triage::decide(&mut conn, UUID_A, Decision::Keep, 168, NOW).unwrap();
        // The final screen was left open; the same backup is imported again.
        let result = import_notes(&mut conn, vec![imported(UUID_A, 1_000)], NOW).unwrap();
        assert_eq!(result.imported, 0);
        let state = triage::get(&mut conn).unwrap();
        assert_eq!((state.counts.kept, state.total), (1, 1));
    }

    #[test]
    fn importing_again_creates_no_duplicate() {
        let mut conn = open_in_memory().unwrap();
        let first = vec![imported(UUID_A, 1_000), imported(UUID_B, 2_000)];
        import_notes(&mut conn, first, NOW).unwrap();
        let again = vec![
            imported(UUID_A, 1_000),
            imported(UUID_B, 2_000),
            imported(UUID_C, 3_000),
        ];
        let result = import_notes(&mut conn, again, NOW).unwrap();
        assert_eq!(
            result,
            ImportResult {
                imported: 1,
                already_imported: 2
            }
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM notes"), 3);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM import_triage"), 3);
    }

    #[test]
    fn a_note_deleted_after_the_import_never_comes_back() {
        let mut conn = open_in_memory().unwrap();
        import_notes(&mut conn, vec![imported(UUID_A, 1_000)], NOW).unwrap();
        // Thrown away during the triage, then purged from the trash: no row left at all.
        triage::decide(&mut conn, UUID_A, Decision::Trash, 168, NOW).unwrap();
        notes::remove_or_tombstone(&conn, UUID_A, NOW).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM notes"), 0);

        let result = import_notes(&mut conn, vec![imported(UUID_A, 1_000)], NOW).unwrap();
        assert_eq!(result.already_imported, 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM notes"), 0);
    }

    #[test]
    fn a_note_already_in_meche_is_skipped() {
        let mut conn = open_in_memory().unwrap();
        // Imported on another device, received by the sync (or its tombstone).
        conn.execute(
            "INSERT INTO notes (id, title, created_at, updated_at, deleted) VALUES (?1, '', 0, 0, 1)",
            [UUID_A],
        )
        .unwrap();
        let result = import_notes(&mut conn, vec![imported(UUID_A, 1_000)], NOW).unwrap();
        assert_eq!(result.already_imported, 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM import_triage"), 0);
    }

    #[test]
    fn ids_that_are_not_uuids_get_a_new_one() {
        let mut conn = open_in_memory().unwrap();
        let upper = UUID_A.to_uppercase();
        let notes = vec![imported(&upper, 1_000), imported("not-a-uuid", 2_000)];
        import_notes(&mut conn, notes, NOW).unwrap();
        assert!(
            notes::get(&conn, UUID_A).is_ok(),
            "uppercase UUIDs are written in lowercase"
        );
        let other: String = conn
            .query_row(
                "SELECT note_id FROM imported_notes WHERE source_id = 'not-a-uuid'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(uuid::Uuid::parse_str(&other).unwrap().get_version_num(), 7);
        // Importing again still recognizes it, by its id in the backup.
        let again = import_notes(&mut conn, vec![imported("not-a-uuid", 2_000)], NOW).unwrap();
        assert_eq!(again.already_imported, 1);
    }

    #[test]
    fn the_same_id_twice_in_one_backup_is_imported_once() {
        let mut conn = open_in_memory().unwrap();
        let notes = vec![imported(UUID_A, 1_000), imported(UUID_A, 2_000)];
        let result = import_notes(&mut conn, notes, NOW).unwrap();
        assert_eq!((result.imported, result.already_imported), (1, 1));
    }

    #[test]
    fn one_invalid_note_imports_nothing() {
        let mut conn = open_in_memory().unwrap();
        let mut too_big = imported(UUID_B, 1_000);
        too_big.content = "a".repeat(MAX_CONTENT_BYTES + 1);
        let mut long_title = imported(UUID_C, 1_000);
        long_title.title = "é".repeat(MAX_TITLE_CHARS + 1);
        for bad in [too_big, long_title] {
            let error =
                import_notes(&mut conn, vec![imported(UUID_A, 1_000), bad], NOW).unwrap_err();
            assert!(
                matches!(error, Error::InvalidInput(ref message) if message.starts_with("imported note 1:"))
            );
        }
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM notes"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM imported_notes"), 0);
        // Exactly at the limits is fine.
        let mut biggest = imported(UUID_B, 1_000);
        biggest.content = "a".repeat(MAX_CONTENT_BYTES);
        biggest.title = "é".repeat(MAX_TITLE_CHARS);
        assert_eq!(
            import_notes(&mut conn, vec![biggest], NOW)
                .unwrap()
                .imported,
            1
        );
    }

    #[test]
    fn a_code_note_without_language_is_plain_text_and_a_rich_note_has_none() {
        let mut conn = open_in_memory().unwrap();
        let mut code = imported(UUID_A, 1_000);
        code.kind = NoteKind::Code;
        let mut rich = imported(UUID_B, 1_000);
        rich.code_language = Some("php".to_string());
        import_notes(&mut conn, vec![code, rich], NOW).unwrap();
        assert_eq!(
            notes::get(&conn, UUID_A).unwrap().code_language.as_deref(),
            Some("plaintext")
        );
        assert_eq!(notes::get(&conn, UUID_B).unwrap().code_language, None);
    }

    #[test]
    fn a_date_in_the_future_becomes_now() {
        let mut conn = open_in_memory().unwrap();
        import_notes(&mut conn, vec![imported(UUID_A, NOW + 1_000)], NOW).unwrap();
        assert_eq!(notes::get(&conn, UUID_A).unwrap().updated_at, NOW);
    }

    #[test]
    fn a_new_import_after_a_finished_triage_starts_new_counts() {
        let mut conn = open_in_memory().unwrap();
        import_notes(&mut conn, vec![imported(UUID_A, 1_000)], NOW).unwrap();
        triage::decide(&mut conn, UUID_A, Decision::Keep, 168, NOW).unwrap();
        import_notes(&mut conn, vec![imported(UUID_B, 1_000)], NOW).unwrap();
        let state = triage::get(&mut conn).unwrap();
        assert_eq!((state.counts.kept, state.total), (0, 1));
        // While a triage is under way, a new import joins it.
        import_notes(&mut conn, vec![imported(UUID_C, 500)], NOW).unwrap();
        let state = triage::get(&mut conn).unwrap();
        assert_eq!(state.total, 2);
        assert_eq!(
            state.cards.last().unwrap().id,
            UUID_C,
            "a new import goes to the end"
        );
        assert_eq!(notes::list(&conn, ListFilter::All).unwrap().len(), 3);
    }
}
