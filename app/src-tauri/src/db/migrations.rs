//! Versioned schema migrations.
//!
//! SQLite remembers which migrations ran in `PRAGMA user_version`, so `run` only applies the
//! missing ones. Never edit a migration that has shipped: append a new one to the list.

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

use crate::error::Result;

/// All migrations, oldest first.
///
/// `include_str!` copies the SQL file into the binary at compile time: nothing is read from
/// disk at runtime. `'static` means the borrowed SQL text lives as long as the program,
/// which is true since it is part of the binary.
const MIGRATION_LIST: &[M<'static>] = &[
    M::up(include_str!("sql/001_initial.sql")).foreign_key_check(),
    M::up(include_str!("sql/002_search_decoded_text.sql")).foreign_key_check(),
    M::up(include_str!("sql/003_imported_notes.sql")).foreign_key_check(),
];

pub const MIGRATIONS: Migrations<'static> = Migrations::from_slice(MIGRATION_LIST);

/// Brings the database schema up to date with `migrations` (always `MIGRATIONS`, except in tests),
/// then turns foreign keys on.
///
/// `&mut Connection`: migrations need exclusive access because they run inside a transaction.
pub fn run(conn: &mut Connection, migrations: &Migrations) -> Result<()> {
    // Migration 002 and its triggers call rich_search_text(): it must exist on this connection.
    super::search::register_functions(conn)?;
    // Foreign keys stay OFF while migrating. Changing a CHECK constraint later means rebuilding
    // a table (create a copy, drop the original, rename the copy): with foreign keys ON, dropping
    // `notes` would also delete every `import_triage` row (ON DELETE CASCADE). Instead,
    // `foreign_key_check()` above verifies all the keys at the end of each migration.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    migrations.to_latest(conn)?;
    // foreign_keys is not saved in the file: it must be turned on for every connection,
    // otherwise SQLite ignores REFERENCES … ON DELETE CASCADE.
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_valid() {
        // Applies every migration to a fresh in-memory database. (MIGRATIONS.validate() would do
        // the same, but on a connection without the SQL functions that migration 002 needs.)
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn, &MIGRATIONS).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATION_LIST.len() as i64);
    }

    #[test]
    fn migration_003_adds_the_import_memory_and_keeps_the_notes() {
        // A database of phase 3 (migrations 001 and 002), with a note waiting for triage.
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn, &Migrations::new(MIGRATION_LIST[..2].to_vec())).unwrap();
        conn.execute_batch(
            "INSERT INTO notes (id, title, content, created_at, updated_at)
               VALUES ('a', 'Courses', 'Lait', 1, 2);
             INSERT INTO import_triage (note_id, position) VALUES ('a', 1);",
        )
        .unwrap();

        run(&mut conn, &MIGRATIONS).unwrap();
        let kept: (String, i64) = conn
            .query_row(
                "SELECT n.content, t.position FROM notes n JOIN import_triage t ON t.note_id = n.id",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(kept, ("Lait".to_string(), 1));
        conn.execute(
            "INSERT INTO imported_notes (source_id, note_id, imported_at) VALUES ('sn-1', 'a', 3)",
            [],
        )
        .unwrap();
        // Its rows outlive the notes: no foreign key.
        conn.execute("DELETE FROM notes WHERE id = 'a'", [])
            .unwrap();
        let remembered: i64 = conn
            .query_row("SELECT COUNT(*) FROM imported_notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remembered, 1);
    }

    #[test]
    fn rebuilding_the_notes_table_keeps_the_rows_that_reference_it() {
        // What a future migration changing a CHECK constraint of `notes` will have to do.
        // SQLite refuses to rename a table under a view that reads it: the search view
        // (migration 002) is dropped first and created again at the end. (A real rebuild would
        // also create the search triggers again: they go with the old table.)
        const REBUILD_NOTES: &str = "
            DROP VIEW notes_search;
            CREATE TABLE notes_new (
              seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
              title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
              kind TEXT NOT NULL DEFAULT 'rich',
              created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            INSERT INTO notes_new (seq, id, title, content, kind, created_at, updated_at)
              SELECT seq, id, title, content, kind, created_at, updated_at FROM notes;
            DROP TABLE notes;
            ALTER TABLE notes_new RENAME TO notes;
            CREATE VIEW notes_search (seq, title, content) AS
              SELECT seq, title,
                     CASE WHEN kind = 'rich' THEN rich_search_text(content) ELSE content END
              FROM notes;";

        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn, &MIGRATIONS).unwrap();
        conn.execute_batch(
            "INSERT INTO notes (id, created_at, updated_at) VALUES ('a', 0, 0);
             INSERT INTO import_triage (note_id, position) VALUES ('a', 1);",
        )
        .unwrap();

        // The published migrations, then the rebuild: only the rebuild runs here.
        let mut list = MIGRATION_LIST.to_vec();
        list.push(M::up(REBUILD_NOTES).foreign_key_check());
        let with_rebuild = Migrations::new(list);
        run(&mut conn, &with_rebuild).unwrap();

        let triage_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM import_triage", [], |row| row.get(0))
            .unwrap();
        assert_eq!(triage_rows, 1);
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1);
    }
}
