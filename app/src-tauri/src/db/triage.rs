//! The triage after an import (docs/07, "Écran de tri"): one imported note at a time, kept, fused,
//! trashed or skipped.
//!
//! The notes still waiting are the rows of `import_triage`, in `position` order (the oldest
//! first, as set by the import). A decision removes the row; how many notes were kept, fused and
//! trashed is counted in the `triage_counts` setting, so the progress and the final screen
//! survive a restart, and do not change when a trashed note is later purged.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::db::notes::{self, NoteColor, NoteKind};
use crate::db::settings;
use crate::error::{Error, Result};

const COUNTS_KEY: &str = "triage_counts";

/// What the user decided for a note (the four buttons of the triage screen).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    /// « Garder » : nothing changes.
    Keep,
    /// « Mèche » : the fuse is lit, with the delay of the settings.
    Fuse,
    /// « Supprimer » : the note goes to the trash.
    Trash,
    /// « Passer » : the note goes back to the end of the queue.
    Skip,
}

/// How many notes were kept, fused and trashed since the triage started.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriageCounts {
    pub kept: u32,
    pub fused: u32,
    pub trashed: u32,
}

impl TriageCounts {
    fn decided(self) -> u32 {
        self.kept + self.fused + self.trashed
    }

    /// The counter of `decision` (`None` for « Passer », which decides nothing). `&mut u32`
    /// borrows one field of `self` mutably, so the caller can add to it or take from it.
    fn counter(&mut self, decision: Decision) -> Option<&mut u32> {
        match decision {
            Decision::Keep => Some(&mut self.kept),
            Decision::Fuse => Some(&mut self.fused),
            Decision::Trash => Some(&mut self.trashed),
            Decision::Skip => None,
        }
    }
}

/// A note waiting for a decision. The frontend reads the whole note with `get_note` when it
/// shows its card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriageCard {
    pub id: String,
    /// The title, or the first line of the content when the title is empty.
    pub title: String,
    pub kind: NoteKind,
    pub color: NoteColor,
    pub updated_at: i64,
}

/// The state of the triage screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Triage {
    /// The notes still waiting, in the order they are shown.
    pub cards: Vec<TriageCard>,
    pub counts: TriageCounts,
    /// Notes of this triage: decided + waiting (« 37 / 104 »).
    pub total: u32,
}

/// What `undo` needs to take a decision back. The frontend keeps these in a stack, in memory,
/// for the « Annuler » button.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TriageUndo {
    pub note_id: String,
    pub decision: Decision,
    /// Place of the note in the queue before the decision.
    pub position: i64,
    /// `updated_at` of the note before the decision: an undone note keeps its old date.
    pub updated_at: i64,
    /// When the decision was taken: the fuse was lit, or the note trashed, at that time.
    pub decided_at: i64,
    /// False when the decision changed nothing in the note (its fuse was lit already…).
    pub changed: bool,
}

pub(crate) fn read_counts(conn: &Connection) -> Result<TriageCounts> {
    Ok(settings::read(conn, COUNTS_KEY)?.unwrap_or_default())
}

fn write_counts(conn: &Connection, counts: TriageCounts) -> Result<()> {
    settings::write(conn, COUNTS_KEY, &counts)
}

/// Starts the counts again when no note is waiting (the last triage is over).
/// `pub(crate)`: called by the import before it adds new notes to the queue.
pub(crate) fn reset_if_finished(conn: &Connection) -> Result<()> {
    if waiting_count(conn)? == 0 {
        conn.execute("DELETE FROM settings WHERE key = ?1", [COUNTS_KEY])?;
    }
    Ok(())
}

fn waiting_count(conn: &Connection) -> Result<u32> {
    Ok(conn.query_row("SELECT COUNT(*) FROM import_triage", [], |row| row.get(0))?)
}

/// The position after the last note of the queue.
pub(crate) fn next_position(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM import_triage",
        [],
        |row| row.get(0),
    )?)
}

/// Position of note `id` in the queue, `None` when it is not waiting.
fn position_of(conn: &Connection, id: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT position FROM import_triage WHERE note_id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?)
}

/// The triage screen's state.
///
/// Notes may have changed since the import, elsewhere in the app or on another device. Those
/// put in the trash count as « Supprimer » ; those deleted for good leave the queue. Both are
/// tidied here, in the same transaction as the reading.
pub fn get(conn: &mut Connection) -> Result<Triage> {
    let tx = conn.transaction()?;
    let mut counts = read_counts(&tx)?;
    let trashed = tx.execute(
        "DELETE FROM import_triage WHERE note_id IN
           (SELECT id FROM notes WHERE deleted = 0 AND trashed_at IS NOT NULL)",
        [],
    )?;
    if trashed > 0 {
        counts.trashed += trashed as u32;
        write_counts(&tx, counts)?;
    }
    // Physically deleted notes leave the queue by themselves (ON DELETE CASCADE); tombstones
    // (deleted = 1) still have a row in `notes`.
    tx.execute(
        "DELETE FROM import_triage WHERE note_id IN (SELECT id FROM notes WHERE deleted = 1)",
        [],
    )?;
    let cards = {
        let mut stmt = tx.prepare(
            "SELECT n.id, n.title, substr(n.content, 1, 400), n.kind, n.color, n.updated_at
             FROM import_triage t JOIN notes n ON n.id = t.note_id
             ORDER BY t.position, n.updated_at, n.id",
        )?;
        stmt.query_map([], |row| {
            let kind: NoteKind = row.get(3)?;
            let stored_title: String = row.get(1)?;
            let content_start: String = row.get(2)?;
            let (title, _preview) = notes::list_texts(&stored_title, &content_start, kind);
            Ok(TriageCard {
                id: row.get(0)?,
                title,
                kind,
                color: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
    }; // `stmt` borrows `tx`: this block ends the borrow before `tx.commit()`.
    tx.commit()?;
    let total = cards.len() as u32 + counts.decided();
    Ok(Triage {
        cards,
        counts,
        total,
    })
}

/// Applies `decision` to note `id`, which must be waiting, and returns what `undo` needs.
/// The note and the queue change in one transaction.
pub fn decide(
    conn: &mut Connection,
    id: &str,
    decision: Decision,
    fuse_delay_hours: i64,
    now: i64,
) -> Result<TriageUndo> {
    let tx = conn.transaction()?;
    let position = position_of(&tx, id)?
        .ok_or_else(|| Error::InvalidInput("this note is not waiting for triage".to_string()))?;
    let note = notes::get(&tx, id)?;
    // Put in the trash elsewhere since its card was shown (a sync, another window): it counts as
    // « Supprimer », whatever the button, like in `get`.
    let decision = if note.trashed_at.is_some() {
        Decision::Trash
    } else {
        decision
    };
    let changed = match decision {
        Decision::Keep | Decision::Skip => false,
        Decision::Fuse => {
            // Refused for a note in the trash (read-only), like the fuse button.
            notes::set_ephemeral(&tx, id, true, fuse_delay_hours, now)?;
            note.ephemeral_mode.is_none()
        }
        Decision::Trash => {
            let in_trash = note.trashed_at.is_some();
            if !in_trash {
                notes::trash(&tx, id, now)?;
            }
            !in_trash
        }
    };
    if decision == Decision::Skip {
        let end = next_position(&tx)?;
        tx.execute(
            "UPDATE import_triage SET position = ?2 WHERE note_id = ?1",
            params![id, end],
        )?;
    } else {
        tx.execute("DELETE FROM import_triage WHERE note_id = ?1", [id])?;
        let mut counts = read_counts(&tx)?;
        if let Some(counter) = counts.counter(decision) {
            *counter += 1;
        }
        write_counts(&tx, counts)?;
    }
    tx.commit()?;
    Ok(TriageUndo {
        note_id: id.to_string(),
        decision,
        position,
        updated_at: note.updated_at,
        decided_at: now,
        changed,
    })
}

/// Takes back the decision described by `undo`: the note returns to its place in the queue,
/// with its fuse out or out of the trash, and its old modification date.
///
/// Refused (`invalid_input`) when the note changed since the decision (edited, restored or
/// deleted elsewhere): putting it back as it was would lose that change.
pub fn undo(conn: &mut Connection, undo: &TriageUndo) -> Result<()> {
    let tx = conn.transaction()?;
    let id = undo.note_id.as_str();
    let note = notes::get(&tx, id)?; // NotFound once deleted for good.
    let waiting = position_of(&tx, id)?.is_some();
    if waiting != (undo.decision == Decision::Skip) {
        return Err(changed_since());
    }
    if undo.changed {
        // `updated_at = decided_at`: nothing touched the note after the decision.
        let reverted = match undo.decision {
            Decision::Fuse => tx.execute(
                "UPDATE notes SET ephemeral_mode = NULL, ephemeral_delay_hours = NULL,
                        ephemeral_started_at = NULL, destroy_at = NULL, updated_at = ?2, dirty = 1
                 WHERE id = ?1 AND deleted = 0 AND trashed_at IS NULL
                   AND ephemeral_started_at = ?3 AND updated_at = ?3",
                params![id, undo.updated_at, undo.decided_at],
            )?,
            Decision::Trash => tx.execute(
                "UPDATE notes SET trashed_at = NULL, trash_reason = NULL, updated_at = ?2, dirty = 1
                 WHERE id = ?1 AND deleted = 0 AND trash_reason = 'manual'
                   AND trashed_at = ?3 AND updated_at = ?3",
                params![id, undo.updated_at, undo.decided_at],
            )?,
            Decision::Keep | Decision::Skip => 1,
        };
        if reverted == 0 {
            return Err(changed_since());
        }
    } else if undo.decision == Decision::Trash && note.trashed_at.is_none() {
        // It was in the trash before the decision, and was restored since.
        return Err(changed_since());
    }
    if undo.decision == Decision::Skip {
        tx.execute(
            "UPDATE import_triage SET position = ?2 WHERE note_id = ?1",
            params![id, undo.position],
        )?;
    } else {
        tx.execute(
            "INSERT INTO import_triage (note_id, position) VALUES (?1, ?2)",
            params![id, undo.position],
        )?;
        let mut counts = read_counts(&tx)?;
        if let Some(counter) = counts.counter(undo.decision) {
            // `saturating_sub` stops at 0 instead of overflowing (the counts may have been
            // started again by a new import in between).
            *counter = counter.saturating_sub(1);
        }
        write_counts(&tx, counts)?;
    }
    tx.commit()?;
    Ok(())
}

fn changed_since() -> Error {
    Error::InvalidInput("the note changed since this decision".to_string())
}

/// Closes the final screen: the counts start again from zero. Refused while notes are waiting.
pub fn finish(conn: &Connection) -> Result<()> {
    if waiting_count(conn)? > 0 {
        return Err(Error::InvalidInput(
            "notes are still waiting for triage".to_string(),
        ));
    }
    reset_if_finished(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::{EphemeralMode, TrashReason};
    use crate::db::open_in_memory;

    const DELAY: i64 = 168;

    /// A note waiting for triage at `position`, modified at `updated_at`.
    fn waiting(conn: &Connection, position: i64, updated_at: i64) -> String {
        let note = notes::create(conn, NoteKind::Rich, updated_at).unwrap();
        conn.execute(
            "INSERT INTO import_triage (note_id, position) VALUES (?1, ?2)",
            params![note.id, position],
        )
        .unwrap();
        note.id
    }

    fn card_ids(conn: &mut Connection) -> Vec<String> {
        get(conn)
            .unwrap()
            .cards
            .into_iter()
            .map(|card| card.id)
            .collect()
    }

    #[test]
    fn cards_follow_the_queue_order() {
        let mut conn = open_in_memory().unwrap();
        let second = waiting(&conn, 2, 10);
        let first = waiting(&conn, 1, 20);
        let triage = get(&mut conn).unwrap();
        assert_eq!(card_ids(&mut conn), [first.clone(), second]);
        assert_eq!(triage.total, 2);
        assert_eq!(triage.counts, TriageCounts::default());
        assert_eq!(triage.cards[0].updated_at, 20);
    }

    #[test]
    fn each_decision_does_what_its_button_says() {
        let mut conn = open_in_memory().unwrap();
        let kept = waiting(&conn, 1, 10);
        let fused = waiting(&conn, 2, 10);
        let trashed = waiting(&conn, 3, 10);
        let skipped = waiting(&conn, 4, 10);
        let last = waiting(&conn, 5, 10);

        decide(&mut conn, &kept, Decision::Keep, DELAY, 100).unwrap();
        decide(&mut conn, &fused, Decision::Fuse, DELAY, 100).unwrap();
        decide(&mut conn, &trashed, Decision::Trash, DELAY, 100).unwrap();
        decide(&mut conn, &skipped, Decision::Skip, DELAY, 100).unwrap();

        let note = notes::get(&conn, &kept).unwrap();
        assert_eq!(
            (note.updated_at, note.ephemeral_mode, note.trashed_at),
            (10, None, None)
        );
        let note = notes::get(&conn, &fused).unwrap();
        assert_eq!(note.ephemeral_mode, Some(EphemeralMode::Delay));
        assert_eq!(note.destroy_at, Some(100 + DELAY * 3_600_000));
        let note = notes::get(&conn, &trashed).unwrap();
        assert_eq!(
            (note.trashed_at, note.trash_reason),
            (Some(100), Some(TrashReason::Manual))
        );

        let triage = get(&mut conn).unwrap();
        // « Passer » sends the note to the end of the queue and counts as nothing.
        assert_eq!(card_ids(&mut conn), [last, skipped]);
        assert_eq!(
            triage.counts,
            TriageCounts {
                kept: 1,
                fused: 1,
                trashed: 1
            }
        );
        assert_eq!(triage.total, 5);
    }

    #[test]
    fn a_note_that_is_not_waiting_cannot_be_decided() {
        let mut conn = open_in_memory().unwrap();
        let note = notes::create(&conn, NoteKind::Rich, 0).unwrap();
        assert!(matches!(
            decide(&mut conn, &note.id, Decision::Keep, DELAY, 1),
            Err(Error::InvalidInput(_))
        ));
        let id = waiting(&conn, 1, 0);
        decide(&mut conn, &id, Decision::Keep, DELAY, 1).unwrap();
        assert!(matches!(
            decide(&mut conn, &id, Decision::Trash, DELAY, 2),
            Err(Error::InvalidInput(_))
        ));
        assert_eq!(get(&mut conn).unwrap().counts.kept, 1);
    }

    #[test]
    fn a_note_trashed_elsewhere_meanwhile_counts_as_trashed_whatever_the_button() {
        // Trashed by a sync between the display of its card and the key press (review, phase 4).
        let mut conn = open_in_memory().unwrap();
        let kept = waiting(&conn, 1, 0);
        let fused = waiting(&conn, 2, 0);
        notes::trash(&conn, &kept, 5).unwrap();
        notes::trash(&conn, &fused, 5).unwrap();
        decide(&mut conn, &kept, Decision::Keep, DELAY, 10).unwrap();
        decide(&mut conn, &fused, Decision::Fuse, DELAY, 10).unwrap();
        assert_eq!(
            read_counts(&conn).unwrap(),
            TriageCounts {
                kept: 0,
                fused: 0,
                trashed: 2
            }
        );
        assert!(card_ids(&mut conn).is_empty());
    }

    #[test]
    fn a_failed_decision_changes_nothing() {
        let mut conn = open_in_memory().unwrap();
        let id = waiting(&conn, 1, 0);
        // Deleted for good on another device (a tombstone) while its card was shown.
        conn.execute("UPDATE notes SET deleted = 1 WHERE id = ?1", [&id])
            .unwrap();
        assert!(matches!(
            decide(&mut conn, &id, Decision::Keep, DELAY, 10),
            Err(Error::NotFound(_))
        ));
        assert_eq!(read_counts(&conn).unwrap(), TriageCounts::default());
        assert_eq!(position_of(&conn, &id).unwrap(), Some(1));
    }

    #[test]
    fn undo_puts_every_decision_back_as_it_was() {
        let mut conn = open_in_memory().unwrap();
        let ids: Vec<String> = (1..=5)
            .map(|position| waiting(&conn, position, 10))
            .collect();
        let before = card_ids(&mut conn);
        let decisions = [
            Decision::Keep,
            Decision::Fuse,
            Decision::Trash,
            Decision::Skip,
        ];
        let mut stack = Vec::new();
        for (id, decision) in ids.iter().zip(decisions) {
            stack.push(decide(&mut conn, id, decision, DELAY, 100).unwrap());
        }
        // Newest first, like the « Annuler » button.
        while let Some(last) = stack.pop() {
            undo(&mut conn, &last).unwrap();
        }

        assert_eq!(card_ids(&mut conn), before);
        assert_eq!(read_counts(&conn).unwrap(), TriageCounts::default());
        for id in &ids {
            let note = notes::get(&conn, id).unwrap();
            // The old modification date is back: the card still says « modifiée il y a … ».
            assert_eq!(
                (
                    note.updated_at,
                    note.ephemeral_mode,
                    note.destroy_at,
                    note.trashed_at
                ),
                (10, None, None, None)
            );
        }
        let dirty: i64 = conn
            .query_row("SELECT dirty FROM notes WHERE id = ?1", [&ids[2]], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(dirty, 1, "an undone note is sent again to the server");
    }

    #[test]
    fn undo_refuses_a_note_changed_since_the_decision() {
        let mut conn = open_in_memory().unwrap();
        let trashed = waiting(&conn, 1, 10);
        let fused = waiting(&conn, 2, 10);
        let trash_undo = decide(&mut conn, &trashed, Decision::Trash, DELAY, 100).unwrap();
        let fuse_undo = decide(&mut conn, &fused, Decision::Fuse, DELAY, 100).unwrap();
        // Restored from the trash, and fuse put out, elsewhere in the app.
        notes::restore(&conn, &trashed, 200).unwrap();
        notes::set_ephemeral(&conn, &fused, false, DELAY, 200).unwrap();

        assert!(matches!(
            undo(&mut conn, &trash_undo),
            Err(Error::InvalidInput(_))
        ));
        assert!(matches!(
            undo(&mut conn, &fuse_undo),
            Err(Error::InvalidInput(_))
        ));
        assert!(card_ids(&mut conn).is_empty());
        assert_eq!(read_counts(&conn).unwrap().trashed, 1);
    }

    #[test]
    fn undo_of_a_decision_that_changed_nothing_leaves_the_note_alone() {
        let mut conn = open_in_memory().unwrap();
        let id = waiting(&conn, 1, 10);
        // Its fuse was lit before the triage: « Mèche » changes nothing, and neither does undo.
        notes::set_ephemeral(&conn, &id, true, 24, 50).unwrap();
        let fuse_undo = decide(&mut conn, &id, Decision::Fuse, DELAY, 100).unwrap();
        assert!(!fuse_undo.changed);
        undo(&mut conn, &fuse_undo).unwrap();
        let note = notes::get(&conn, &id).unwrap();
        assert_eq!(
            (
                note.ephemeral_delay_hours,
                note.ephemeral_started_at,
                note.updated_at
            ),
            (Some(24), Some(50), 50)
        );
        assert_eq!(card_ids(&mut conn), [id]);
    }

    #[test]
    fn notes_trashed_or_deleted_elsewhere_leave_the_queue() {
        let mut conn = open_in_memory().unwrap();
        let trashed = waiting(&conn, 1, 0);
        let deleted = waiting(&conn, 2, 0);
        let tombstone = waiting(&conn, 3, 0);
        let kept = waiting(&conn, 4, 0);
        notes::trash(&conn, &trashed, 1).unwrap();
        conn.execute("DELETE FROM notes WHERE id = ?1", [&deleted])
            .unwrap();
        // A tombstone received from the server keeps its row in `notes`.
        conn.execute("UPDATE notes SET deleted = 1 WHERE id = ?1", [&tombstone])
            .unwrap();

        let triage = get(&mut conn).unwrap();
        assert_eq!(card_ids(&mut conn), [kept]);
        assert_eq!(triage.counts.trashed, 1);
        assert_eq!(triage.total, 2);
    }

    #[test]
    fn counts_survive_the_purge_of_trashed_notes() {
        let mut conn = open_in_memory().unwrap();
        let id = waiting(&conn, 1, 0);
        waiting(&conn, 2, 0);
        decide(&mut conn, &id, Decision::Trash, DELAY, 1).unwrap();
        notes::remove_or_tombstone(&conn, &id, 2).unwrap();
        let triage = get(&mut conn).unwrap();
        assert_eq!((triage.counts.trashed, triage.total), (1, 2));
    }

    #[test]
    fn finish_starts_the_counts_again_only_when_nothing_is_waiting() {
        let mut conn = open_in_memory().unwrap();
        let id = waiting(&conn, 1, 0);
        decide(&mut conn, &id, Decision::Skip, DELAY, 1).unwrap();
        assert!(matches!(finish(&conn), Err(Error::InvalidInput(_))));
        decide(&mut conn, &id, Decision::Keep, DELAY, 2).unwrap();
        assert_eq!(get(&mut conn).unwrap().counts.kept, 1);
        finish(&conn).unwrap();
        let triage = get(&mut conn).unwrap();
        assert_eq!((triage.counts, triage.total), (TriageCounts::default(), 0));
    }
}
