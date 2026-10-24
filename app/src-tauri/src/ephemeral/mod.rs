//! Notes with a lit fuse destroy themselves, and the trash empties itself (docs/06).
//!
//! In the interface this is "la mèche": a note whose fuse is lit goes to the trash once its delay
//! is over. The code keeps the technical word `ephemeral`.

pub mod watcher;

use rusqlite::{Connection, params};

use crate::db::notes::{TrashReason, remove_or_tombstone};
use crate::error::{Error, Result};

/// Days a note stays in the trash before it is deleted for good (docs/06).
pub const TRASH_RETENTION_DAYS: i64 = 7;

const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;

/// When a fuse lit at `started_at` with a delay of `delay_hours` burns out.
pub fn destroy_at(started_at: i64, delay_hours: i64) -> i64 {
    started_at + delay_hours * HOUR_MS
}

/// Moves to the trash every note whose fuse has burnt out at `now`. Returns how many.
///
/// Deterministic on purpose: `trashed_at` is the moment the fuse burnt out (`destroy_at`), not
/// `now`. The server will run the same rule, and both sides then hold exactly the same values,
/// so the sync sees no conflict (docs/04). Only `updated_at`, which the sync ignores in this
/// comparison, says when it happened here.
pub fn explode_due(conn: &Connection, now: i64) -> Result<usize> {
    let exploded = conn.execute(
        "UPDATE notes
         SET trashed_at = destroy_at, trash_reason = ?2, dirty = 1, updated_at = ?1
         WHERE destroy_at IS NOT NULL AND destroy_at <= ?1
           AND trashed_at IS NULL AND deleted = 0",
        params![now, TrashReason::SelfDestruct],
    )?;
    Ok(exploded)
}

/// Deletes for good the notes that have been in the trash for `TRASH_RETENTION_DAYS` days.
/// Returns how many. Like a deletion by hand, a note the server has seen leaves a tombstone.
///
/// The server will purge too. Until there is a server (phase 3), the device always does it.
pub fn purge_trash(conn: &Connection, now: i64) -> Result<usize> {
    let limit = now - TRASH_RETENTION_DAYS * DAY_MS;
    let ids = {
        let mut stmt = conn.prepare(
            "SELECT id FROM notes WHERE deleted = 0 AND trashed_at IS NOT NULL AND trashed_at <= ?1",
        )?;
        stmt.query_map([limit], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?
    }; // The block ends the borrow of `conn` by `stmt` before the notes are changed.
    for id in &ids {
        remove_or_tombstone(conn, id, now)?;
    }
    Ok(ids.len())
}

/// Runs both jobs in one transaction. Returns true when a note changed: the caller then tells
/// the interface (`notes-changed` event, docs/02).
///
/// `&mut Connection`: a transaction needs exclusive access to the connection.
pub fn run_maintenance(conn: &mut Connection, now: i64) -> Result<bool> {
    let tx = conn.transaction()?;
    // A `Transaction` can be used wherever a `&Connection` is expected (it "derefs" to it).
    let exploded = explode_due(&tx, now)?;
    let purged = purge_trash(&tx, now)?;
    tx.commit()?;
    Ok(exploded + purged > 0)
}

/// `run_maintenance` for the callers that must keep working when it fails: the startup and
/// `list_notes` (a list must never fail because of a background job). The error is logged and
/// counts as "nothing changed": the transaction is rolled back when it is dropped, and the
/// watcher tries again a minute later.
///
/// A second Mèche window writing at the same time is not an error: the connection waits up to
/// 5 s for the database to be free (`db::prepare`), and every write here takes a few ms.
pub fn run_maintenance_or_log(conn: &mut Connection, now: i64) -> bool {
    match run_maintenance(conn, now) {
        Ok(changed) => changed,
        Err(error) => {
            eprintln!("fuse maintenance failed: {error}");
            false
        }
    }
}

/// What `maintenance_before_action` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BeforeAction {
    /// Notes changed: the interface must be told (`notes-changed`).
    pub changed: bool,
    /// The note about to be acted on has just exploded: its fuse had burnt out already.
    pub exploded: bool,
}

/// Runs the maintenance before an action on note `id` that depends on its fuse or its trash
/// state (putting the fuse out, moving to the trash).
///
/// Closes the "one minute window" of docs/06: between `destroy_at` and the next maintenance
/// (60 s at most), a note whose fuse has burnt out still looked alive. Acting on it then could
/// give a conflict copy if the server had already exploded it. Now the note explodes first,
/// as it should have, and the action sees it in the trash.
pub fn maintenance_before_action(
    conn: &mut Connection,
    id: &str,
    now: i64,
) -> Result<BeforeAction> {
    let was_in_trash = trashed_at(conn, id)?.is_some();
    let changed = run_maintenance_or_log(conn, now);
    let exploded = match trashed_at(conn, id) {
        Ok(trashed) => !was_in_trash && trashed.is_some(),
        // Gone: it exploded and was purged by this very maintenance (its fuse burnt out more
        // than 7 days ago). The maintenance changed notes: the caller must still say so.
        Err(Error::NotFound(_)) => true,
        Err(error) => return Err(error),
    };
    Ok(BeforeAction { changed, exploded })
}

/// `trashed_at` of note `id` (`NotFound` when there is no such note).
fn trashed_at(conn: &Connection, id: &str) -> Result<Option<i64>> {
    Ok(crate::db::notes::get(conn, id)?.trashed_at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::{self, ListFilter, NoteKind};
    use crate::db::open_in_memory;

    /// A note whose fuse was lit at `started_at` for `delay_hours` hours.
    fn fused_note(conn: &Connection, started_at: i64, delay_hours: i64) -> String {
        let note = notes::create(conn, NoteKind::Rich, started_at).unwrap();
        conn.execute(
            "UPDATE notes SET ephemeral_mode = 'delay', ephemeral_delay_hours = ?2,
                    ephemeral_started_at = ?3, destroy_at = ?4, dirty = 0
             WHERE id = ?1",
            params![
                note.id,
                delay_hours,
                started_at,
                destroy_at(started_at, delay_hours)
            ],
        )
        .unwrap();
        note.id
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn destroy_at_adds_the_delay_in_hours() {
        assert_eq!(destroy_at(1_000, 1), 3_601_000);
        assert_eq!(destroy_at(0, 168), 7 * DAY_MS);
    }

    #[test]
    fn only_burnt_out_fuses_explode() {
        let conn = open_in_memory().unwrap();
        let due = fused_note(&conn, 0, 1);
        let later = fused_note(&conn, 0, 2);
        let unfused = notes::create(&conn, NoteKind::Rich, 0).unwrap();

        // Exactly at destroy_at: the fuse has burnt out.
        assert_eq!(explode_due(&conn, HOUR_MS).unwrap(), 1);

        let exploded = notes::get(&conn, &due).unwrap();
        assert_eq!(exploded.trashed_at, Some(HOUR_MS));
        assert_eq!(exploded.trash_reason, Some(TrashReason::SelfDestruct));
        assert_eq!(exploded.updated_at, HOUR_MS);
        assert_eq!(notes::get(&conn, &later).unwrap().trashed_at, None);
        assert_eq!(notes::get(&conn, &unfused.id).unwrap().trashed_at, None);
        // Marked for the next sync; the note still burning was not touched.
        let dirty = |id: &str| -> i64 {
            conn.query_row("SELECT dirty FROM notes WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .unwrap()
        };
        assert_eq!((dirty(&due), dirty(&later)), (1, 0));
    }

    #[test]
    fn a_late_explosion_still_dates_the_trash_from_destroy_at() {
        // The app was closed for days: trashed_at is the moment the fuse burnt out, as on the
        // server, and not the moment the app noticed it.
        let conn = open_in_memory().unwrap();
        let id = fused_note(&conn, 0, 1);
        explode_due(&conn, 5 * DAY_MS).unwrap();
        let note = notes::get(&conn, &id).unwrap();
        assert_eq!(note.trashed_at, Some(HOUR_MS));
        assert_eq!(note.updated_at, 5 * DAY_MS);
    }

    #[test]
    fn notes_already_in_the_trash_or_deleted_do_not_explode_again() {
        let conn = open_in_memory().unwrap();
        let trashed = fused_note(&conn, 0, 1);
        notes::trash(&conn, &trashed, 10).unwrap();
        let tombstone = fused_note(&conn, 0, 1);
        conn.execute("UPDATE notes SET deleted = 1 WHERE id = ?1", [&tombstone])
            .unwrap();

        assert_eq!(explode_due(&conn, DAY_MS).unwrap(), 0);
        let note = notes::get(&conn, &trashed).unwrap();
        assert_eq!(note.trashed_at, Some(10));
        assert_eq!(note.trash_reason, Some(TrashReason::Manual));
    }

    #[test]
    fn purge_deletes_notes_after_seven_days_in_the_trash() {
        let conn = open_in_memory().unwrap();
        let old = notes::create(&conn, NoteKind::Rich, 0).unwrap();
        let recent = notes::create(&conn, NoteKind::Rich, 0).unwrap();
        notes::trash(&conn, &old.id, 1_000).unwrap();
        notes::trash(&conn, &recent.id, 1_001).unwrap();

        // One millisecond short of 7 days for `old`: nothing goes.
        let seven_days_after_old = 1_000 + TRASH_RETENTION_DAYS * DAY_MS;
        assert_eq!(purge_trash(&conn, seven_days_after_old - 1).unwrap(), 0);
        // Exactly 7 days: `old` goes, `recent` (trashed 1 ms later) stays.
        assert_eq!(purge_trash(&conn, seven_days_after_old).unwrap(), 1);
        let trash = notes::list(&conn, ListFilter::Trash).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].id, recent.id);
        // Never synced: removed from the database, not kept as a tombstone.
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM notes"), 1);
    }

    #[test]
    fn purging_a_synced_note_leaves_a_tombstone() {
        let conn = open_in_memory().unwrap();
        let note = notes::create(&conn, NoteKind::Rich, 0).unwrap();
        conn.execute(
            "UPDATE notes SET title = 'Courses', content = 'secret', server_rev = 3 WHERE id = ?1",
            [&note.id],
        )
        .unwrap();
        notes::trash(&conn, &note.id, 0).unwrap();

        assert_eq!(
            purge_trash(&conn, TRASH_RETENTION_DAYS * DAY_MS).unwrap(),
            1
        );
        let (deleted, title, content, dirty): (i64, String, String, i64) = conn
            .query_row(
                "SELECT deleted, title, content, dirty FROM notes WHERE id = ?1",
                [&note.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            (deleted, title.as_str(), content.as_str(), dirty),
            (1, "", "", 1)
        );
        // A tombstone is not purged a second time.
        assert_eq!(purge_trash(&conn, 30 * DAY_MS).unwrap(), 0);
    }

    #[test]
    fn maintenance_explodes_then_purges_and_says_whether_anything_changed() {
        let mut conn = open_in_memory().unwrap();
        let id = fused_note(&conn, 0, 1);
        assert!(!run_maintenance(&mut conn, HOUR_MS - 1).unwrap());
        assert!(run_maintenance(&mut conn, HOUR_MS).unwrap());
        assert!(!run_maintenance(&mut conn, HOUR_MS + 1).unwrap());

        // 7 days after the explosion (trashed_at = destroy_at), the note is purged.
        let purge_time = HOUR_MS + TRASH_RETENTION_DAYS * DAY_MS;
        assert!(!run_maintenance(&mut conn, purge_time - 1).unwrap());
        assert!(run_maintenance(&mut conn, purge_time).unwrap());
        assert!(notes::get(&conn, &id).is_err());
    }

    #[test]
    fn a_failing_maintenance_is_logged_not_returned() {
        // A database without the notes table: run_maintenance fails.
        let mut broken = Connection::open_in_memory().unwrap();
        assert!(run_maintenance(&mut broken, 0).is_err());
        assert!(!run_maintenance_or_log(&mut broken, 0));

        let mut conn = open_in_memory().unwrap();
        fused_note(&conn, 0, 1);
        assert!(run_maintenance_or_log(&mut conn, HOUR_MS));
    }

    #[test]
    fn a_burnt_fuse_explodes_before_an_action_on_its_note() {
        let mut conn = open_in_memory().unwrap();
        let due = fused_note(&conn, 0, 1);
        let alive = fused_note(&conn, 0, 2);

        // The other note is alive: nothing exploded for it, but `due` did.
        let before = maintenance_before_action(&mut conn, &alive, HOUR_MS).unwrap();
        assert_eq!(
            before,
            BeforeAction {
                changed: true,
                exploded: false
            }
        );
        assert_eq!(notes::get(&conn, &due).unwrap().trashed_at, Some(HOUR_MS));

        let later = fused_note(&conn, 0, 3);
        let before = maintenance_before_action(&mut conn, &later, 3 * HOUR_MS).unwrap();
        assert_eq!(
            before,
            BeforeAction {
                changed: true,
                exploded: true
            }
        );
        // Already in the trash before: not "just exploded".
        let again = maintenance_before_action(&mut conn, &later, 4 * HOUR_MS).unwrap();
        assert!(!again.exploded);
        assert!(matches!(
            maintenance_before_action(&mut conn, "missing", 0),
            Err(crate::error::Error::NotFound(_))
        ));
    }

    #[test]
    fn a_note_purged_by_the_maintenance_before_an_action_still_says_notes_changed() {
        let mut conn = open_in_memory().unwrap();
        // Its fuse burnt out 8 days ago: it explodes and is purged in the same run.
        let gone = fused_note(&conn, 0, 1);
        let now = HOUR_MS + 8 * DAY_MS;

        let before = maintenance_before_action(&mut conn, &gone, now).unwrap();

        assert_eq!(
            before,
            BeforeAction {
                changed: true,
                exploded: true
            }
        );
        assert!(notes::get(&conn, &gone).is_err());
    }

    #[test]
    fn a_note_whose_fuse_burnt_out_long_ago_is_purged_at_once() {
        // Closed for a month: the note explodes (dated from destroy_at) and is purged in the
        // same run, as the server would have done.
        let mut conn = open_in_memory().unwrap();
        fused_note(&conn, 0, 1);
        assert!(run_maintenance(&mut conn, 30 * DAY_MS).unwrap());
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM notes"), 0);
    }
}
