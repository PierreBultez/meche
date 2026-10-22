//! Local SQLite database: opening, configuration and migrations (docs/03-modele-donnees.md).

mod migrations;

use std::path::Path;

use rusqlite::Connection;

use crate::error::Result;

/// File name of the local database, inside the app data directory.
pub const DB_FILE_NAME: &str = "notes.db";

/// Opens `notes.db` in `data_dir` (creating the folder and the file if needed),
/// then brings its schema up to date.
///
/// `data_dir: &Path` is a borrowed path: the caller keeps ownership, we only read it.
pub fn open_in_dir(data_dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(data_dir)?;
    // `mut` because the migrations below need exclusive (`&mut`) access to the connection.
    let mut conn = Connection::open(data_dir.join(DB_FILE_NAME))?;
    configure(&conn)?;
    migrations::run(&mut conn)?;
    Ok(conn)
}

/// Opens a throwaway database in memory, fully migrated. For tests only.
#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrations::run(&mut conn)?;
    Ok(conn)
}

/// Connection settings that SQLite does not store in the file: applied at every opening.
fn configure(conn: &Connection) -> Result<()> {
    // WAL journal: faster writes, and reads never wait for a write in progress.
    // foreign_keys: SQLite ignores REFERENCES … ON DELETE CASCADE unless this is ON.
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn insert_note(conn: &Connection, id: &str, title: &str, content: &str) {
        conn.execute(
            "INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0)",
            params![id, title, content],
        )
        .unwrap();
    }

    /// Ids of the notes matching a full-text query, sorted.
    fn search(conn: &Connection, query: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT n.id FROM notes_fts JOIN notes n ON n.seq = notes_fts.rowid
                 WHERE notes_fts MATCH ?1 ORDER BY n.id",
            )
            .unwrap();
        stmt.query_map([query], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<String>>>()
            .unwrap()
    }

    fn names_of(conn: &Connection, object_type: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = ?1 AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'notes_fts_%'
                 ORDER BY name",
            )
            .unwrap();
        stmt.query_map([object_type], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<String>>>()
            .unwrap()
    }

    #[test]
    fn creates_notes_db_with_the_full_schema() {
        let dir = tempfile::tempdir().unwrap();
        // A sub-folder that does not exist yet, like the app data dir on first launch.
        let data_dir = dir.path().join("fr.pierrebultez.meche");
        let conn = open_in_dir(&data_dir).unwrap();

        assert!(data_dir.join(DB_FILE_NAME).is_file());
        assert_eq!(
            names_of(&conn, "table"),
            ["import_triage", "notes", "notes_fts", "settings"]
        );
        assert_eq!(
            names_of(&conn, "index"),
            ["idx_notes_destroy", "idx_notes_dirty", "idx_notes_list"]
        );
        assert_eq!(
            names_of(&conn, "trigger"),
            ["notes_ad", "notes_ai", "notes_au"]
        );

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode, "wal");
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1);
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn reopening_keeps_data_and_does_not_rerun_migrations() {
        let dir = tempfile::tempdir().unwrap();
        {
            let conn = open_in_dir(dir.path()).unwrap();
            insert_note(&conn, "a", "Courses", "Lait");
        } // `conn` goes out of scope here: Rust closes the database automatically.

        let conn = open_in_dir(dir.path()).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn search_index_follows_inserts_updates_and_deletes() {
        let conn = open_in_memory().unwrap();
        insert_note(&conn, "a", "Courses", "Lait et pain");
        insert_note(&conn, "b", "Serveur", "Apache et certbot");
        assert_eq!(search(&conn, "pain"), ["a"]);

        conn.execute(
            "UPDATE notes SET content = 'Lait et beurre' WHERE id = 'a'",
            [],
        )
        .unwrap();
        assert!(search(&conn, "pain").is_empty());
        assert_eq!(search(&conn, "beurre"), ["a"]);

        conn.execute("DELETE FROM notes WHERE id = 'b'", [])
            .unwrap();
        assert!(search(&conn, "certbot").is_empty());
    }

    #[test]
    fn search_ignores_accents_and_case() {
        let conn = open_in_memory().unwrap();
        insert_note(&conn, "a", "Réunion école", "Préparer le goûter de Noël");
        assert_eq!(search(&conn, "reunion"), ["a"]);
        assert_eq!(search(&conn, "ECOLE"), ["a"]);
        assert_eq!(search(&conn, "gouter"), ["a"]);
        assert_eq!(search(&conn, "noel"), ["a"]);
    }

    #[test]
    fn search_index_survives_vacuum() {
        // Why `seq INTEGER PRIMARY KEY` exists: VACUUM may renumber an implicit rowid.
        let conn = open_in_memory().unwrap();
        insert_note(&conn, "a", "Première", "un");
        insert_note(&conn, "b", "Deuxième", "deux");
        insert_note(&conn, "c", "Troisième", "trois");
        conn.execute("DELETE FROM notes WHERE id = 'a'", [])
            .unwrap();
        conn.execute_batch("VACUUM").unwrap();

        assert_eq!(search(&conn, "deux"), ["b"]);
        assert_eq!(search(&conn, "trois"), ["c"]);
    }

    #[test]
    fn rejects_invalid_values() {
        let conn = open_in_memory().unwrap();
        let invalid_kind = conn.execute(
            "INSERT INTO notes (id, kind, created_at, updated_at) VALUES ('a', 'video', 0, 0)",
            [],
        );
        assert!(invalid_kind.is_err());
        let invalid_color = conn.execute(
            "INSERT INTO notes (id, color, created_at, updated_at) VALUES ('a', 'noir', 0, 0)",
            [],
        );
        assert!(invalid_color.is_err());
        let missing_id = conn.execute(
            "INSERT INTO notes (created_at, updated_at) VALUES (0, 0)",
            [],
        );
        assert!(missing_id.is_err());
    }

    #[test]
    fn note_ids_are_unique() {
        let conn = open_in_memory().unwrap();
        insert_note(&conn, "a", "Une", "");
        let duplicate = conn.execute(
            "INSERT INTO notes (id, created_at, updated_at) VALUES ('a', 0, 0)",
            [],
        );
        assert!(duplicate.is_err());
    }

    #[test]
    fn deleting_a_note_removes_it_from_import_triage() {
        let conn = open_in_memory().unwrap();
        insert_note(&conn, "a", "Importée", "");
        conn.execute(
            "INSERT INTO import_triage (note_id, position) VALUES ('a', 1)",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM notes WHERE id = 'a'", [])
            .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM import_triage", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn import_triage_only_accepts_existing_notes() {
        let conn = open_in_memory().unwrap();
        let orphan = conn.execute(
            "INSERT INTO import_triage (note_id, position) VALUES ('missing', 1)",
            [],
        );
        assert!(orphan.is_err());
    }
}
