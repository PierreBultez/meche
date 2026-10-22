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
const MIGRATION_LIST: &[M<'static>] =
    &[M::up(include_str!("sql/001_initial.sql")).foreign_key_check()];

pub const MIGRATIONS: Migrations<'static> = Migrations::from_slice(MIGRATION_LIST);

/// Brings the database schema up to date with `migrations` (always `MIGRATIONS`, except in tests),
/// then turns foreign keys on.
///
/// `&mut Connection`: migrations need exclusive access because they run inside a transaction.
pub fn run(conn: &mut Connection, migrations: &Migrations) -> Result<()> {
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
        // Applies every migration to a fresh in-memory database.
        MIGRATIONS.validate().unwrap();
    }

    #[test]
    fn rebuilding_the_notes_table_keeps_the_rows_that_reference_it() {
        // What a future migration changing a CHECK constraint of `notes` will have to do.
        const REBUILD_NOTES: &str = "
            CREATE TABLE notes_new (
              seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
              created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            INSERT INTO notes_new (seq, id, created_at, updated_at)
              SELECT seq, id, created_at, updated_at FROM notes;
            DROP TABLE notes;
            ALTER TABLE notes_new RENAME TO notes;";

        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn, &MIGRATIONS).unwrap();
        conn.execute_batch(
            "INSERT INTO notes (id, created_at, updated_at) VALUES ('a', 0, 0);
             INSERT INTO import_triage (note_id, position) VALUES ('a', 1);",
        )
        .unwrap();

        let with_rebuild = Migrations::new(vec![
            M::up(include_str!("sql/001_initial.sql")).foreign_key_check(),
            M::up(REBUILD_NOTES).foreign_key_check(),
        ]);
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
