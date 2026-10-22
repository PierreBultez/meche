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
const MIGRATION_LIST: &[M<'static>] = &[M::up(include_str!("sql/001_initial.sql"))];

const MIGRATIONS: Migrations<'static> = Migrations::from_slice(MIGRATION_LIST);

/// Brings the database schema up to the latest version.
///
/// `&mut Connection`: migrations need exclusive access to the connection because each one
/// runs inside a transaction.
pub fn run(conn: &mut Connection) -> Result<()> {
    MIGRATIONS.to_latest(conn)?;
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
}
