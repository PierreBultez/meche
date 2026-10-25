//! The sync on the SQLite side (docs/04, "Traitement client"): which local changes to send,
//! and how to apply the server's answer. Plain functions on a connection, without network:
//! they are tested here with an in-memory database.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, Row, params};

use super::config;
use super::protocol::{Applied, Change, ServerNote, SyncNote, SyncResponse};
use crate::db::notes::insert_conflict_copy;
use crate::error::Result;

/// At most 200 notes per request, and about 4 MB (docs/04): the server refuses more, and PHP
/// would refuse a too large body. A note larger than that is still sent, alone.
pub const MAX_CHANGES: usize = 200;
pub const MAX_CHANGE_BYTES: i64 = 4 * 1024 * 1024;

const SYNC_COLUMNS: &str = "id, title, content, kind, code_language, pinned, color, \
     ephemeral_mode, ephemeral_delay_hours, ephemeral_started_at, destroy_at, trashed_at, \
     trash_reason, deleted, created_at, updated_at";

/// The local notes to send next.
#[derive(Debug, Default)]
pub struct Batch {
    pub changes: Vec<Change>,
    /// Other notes are waiting: the limits of one request were reached.
    pub more: bool,
}

/// Versions of notes sent to the server by requests whose answer never came back (lost
/// connection, timeout), by note id. The server may have applied them: if it later sends back
/// one of them, it is this device's own version, not another device's (docs/04). Kept in
/// memory only, for the time the app runs: after a restart, a note changed since a lost
/// answer gives a conflict copy (nothing is lost).
pub type Unacknowledged = HashMap<String, Vec<SyncNote>>;

/// What applying an answer did, for the interface.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Outcome {
    /// A note was added, changed or removed: the list and the open note must be reloaded.
    /// Only acknowledging changes sent by this device changes nothing visible.
    pub changed: bool,
    /// Conflict copies « (conflit du …) » created.
    pub conflict_copies: usize,
    /// Notes left to be sent at once: this device's own version came back after a lost
    /// answer, and the note changed or was deleted here since.
    pub resend: bool,
}

/// A local note with its sync columns.
struct Local {
    note: SyncNote,
    server_rev: i64,
    dirty: bool,
}

fn sync_note_from_row(row: &Row<'_>) -> rusqlite::Result<SyncNote> {
    Ok(SyncNote {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        kind: row.get(3)?,
        code_language: row.get(4)?,
        pinned: row.get(5)?,
        color: row.get(6)?,
        ephemeral_mode: row.get(7)?,
        ephemeral_delay_hours: row.get(8)?,
        ephemeral_started_at: row.get(9)?,
        destroy_at: row.get(10)?,
        trashed_at: row.get(11)?,
        trash_reason: row.get(12)?,
        deleted: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

/// The local note `id`, tombstones included.
fn local(conn: &Connection, id: &str) -> Result<Option<Local>> {
    let found = conn
        .query_row(
            &format!("SELECT {SYNC_COLUMNS}, server_rev, dirty FROM notes WHERE id = ?1"),
            [id],
            |row| {
                Ok(Local {
                    note: sync_note_from_row(row)?,
                    server_rev: row.get(16)?,
                    dirty: row.get(17)?,
                })
            },
        )
        .optional()?;
    Ok(found)
}

/// The notes modified here and not sent yet (`dirty`), oldest first, within the limits of one
/// request. Their sizes are read first, so that a batch never loads more notes than it sends.
pub fn collect_changes(conn: &Connection, max_notes: usize, max_bytes: i64) -> Result<Batch> {
    let candidates = {
        let mut stmt = conn.prepare(
            // CAST AS BLOB: length() then counts bytes, not characters.
            "SELECT id, length(CAST(title AS BLOB)) + length(CAST(content AS BLOB))
             FROM notes WHERE dirty = 1 ORDER BY updated_at, id LIMIT ?1",
        )?;
        stmt.query_map([max_notes as i64 + 1], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
    };

    let mut batch = Batch::default();
    let mut bytes = 0;
    for (id, size) in &candidates {
        let full = batch.changes.len() == max_notes
            || (!batch.changes.is_empty() && bytes + size > max_bytes);
        if full {
            batch.more = true;
            break;
        }
        // `let … else`: the note was just read, so it is there; skip it otherwise.
        let Some(local) = local(conn, id)? else {
            continue;
        };
        bytes += size;
        batch.changes.push(Change {
            note: local.note,
            base_rev: local.server_rev,
        });
    }
    Ok(batch)
}

/// Applies the server's answer to the changes `sent`, in one transaction (docs/04): first what
/// it accepted, then the conflicts, then the notes changed elsewhere; then the new cursor.
/// `unacknowledged`: versions sent by earlier requests whose answer was lost.
pub fn apply_response(
    conn: &mut Connection,
    sent: &[Change],
    response: &SyncResponse,
    now: i64,
    unacknowledged: &Unacknowledged,
) -> Result<Outcome> {
    let tx = conn.transaction()?;
    let mut outcome = Outcome::default();
    for applied in &response.applied {
        acknowledge(&tx, sent, applied)?;
    }
    for conflict in &response.conflicts {
        resolve_conflict(&tx, &conflict.server, now, unacknowledged, &mut outcome)?;
    }
    for server in &response.changes {
        receive(&tx, server, now, unacknowledged, &mut outcome)?;
    }
    config::save_cursor(&tx, response.cursor)?;
    config::save_last_sync(&tx, now)?;
    tx.commit()?;
    Ok(outcome)
}

/// The server accepted a change: the note is now known at revision `applied.rev`.
fn acknowledge(conn: &Connection, sent: &[Change], applied: &Applied) -> Result<()> {
    let Some(change) = sent.iter().find(|change| change.note.id == applied.id) else {
        return Ok(());
    };
    let Some(local) = local(conn, &applied.id)? else {
        // Deleted for good here while the request was on its way: a note the server had never
        // seen is removed without a tombstone, but the server has just stored it. Its deletion
        // must reach the server and the other devices: a tombstone, still to be sent.
        if !change.note.deleted && applied.rev > 0 {
            insert_tombstone(conn, &change.note, applied.rev)?;
        }
        return Ok(());
    };
    if change.note.deleted && local.note.deleted {
        // The deletion reached the server: the tombstone is no longer needed here.
        conn.execute("DELETE FROM notes WHERE id = ?1", [&applied.id])?;
    } else if local.note == change.note {
        conn.execute(
            "UPDATE notes SET server_rev = ?2, dirty = 0 WHERE id = ?1",
            params![applied.id, applied.rev],
        )?;
    } else {
        // Changed again while the request was on its way: still to be sent, from this revision.
        conn.execute(
            "UPDATE notes SET server_rev = ?2 WHERE id = ?1",
            params![applied.id, applied.rev],
        )?;
    }
    Ok(())
}

/// A tombstone of `note` known to the server at revision `rev`, still to be sent.
fn insert_tombstone(conn: &Connection, note: &SyncNote, rev: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO notes (id, title, content, kind, code_language, pinned, color,
                            ephemeral_mode, ephemeral_delay_hours, ephemeral_started_at,
                            destroy_at, trashed_at, trash_reason, deleted, created_at, updated_at,
                            server_rev, dirty)
         VALUES (?1, '', '', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?13, ?14, 1)",
        params![
            note.id,
            note.kind,
            note.code_language,
            note.pinned,
            note.color,
            note.ephemeral_mode,
            note.ephemeral_delay_hours,
            note.ephemeral_started_at,
            note.destroy_at,
            note.trashed_at,
            note.trash_reason,
            note.created_at,
            note.updated_at,
            rev
        ],
    )?;
    Ok(())
}

/// A note changed on another device.
fn receive(
    conn: &Connection,
    server: &ServerNote,
    now: i64,
    unacknowledged: &Unacknowledged,
    outcome: &mut Outcome,
) -> Result<()> {
    match local(conn, &server.note.id)? {
        // Deleted before this device ever had it.
        None if server.note.deleted => {}
        // Already known at this revision or a later one (e.g. a note this device just sent).
        Some(local) if server.rev <= local.server_rev => {}
        // Modified here too and not sent yet: a conflict (docs/04).
        Some(local) if local.dirty => resolve_conflict(conn, server, now, unacknowledged, outcome)?,
        // Sent by this device, whose answer was lost, then deleted for good here: without
        // this, the note would come back.
        None if sent_here(unacknowledged, server) => {
            insert_tombstone(conn, &server.note, server.rev)?;
            outcome.resend = true;
        }
        _ => {
            store(conn, server)?;
            outcome.changed = true;
        }
    }
    Ok(())
}

/// The server kept its version (docs/04): the local one is kept as a conflict copy, then the
/// server's replaces it. Nothing is ever lost. No copy when the local note is a tombstone
/// (there is nothing in it: the note simply comes back) or holds the same thing.
fn resolve_conflict(
    conn: &Connection,
    server: &ServerNote,
    now: i64,
    unacknowledged: &Unacknowledged,
    outcome: &mut Outcome,
) -> Result<()> {
    let local = local(conn, &server.note.id)?;
    // The server holds a version this device sent, whose answer was lost: it is not another
    // device's version.
    if sent_here(unacknowledged, server) {
        match &local {
            // Deleted for good here since: the deletion still has to reach the server.
            None if !server.note.deleted => {
                insert_tombstone(conn, &server.note, server.rev)?;
                outcome.resend = true;
                return Ok(());
            }
            // Changed here since: the note goes on from that revision, still to be sent.
            Some(local) if local.dirty && !local.note.same_as(&server.note) => {
                conn.execute(
                    "UPDATE notes SET server_rev = ?2 WHERE id = ?1",
                    params![server.note.id, server.rev],
                )?;
                outcome.resend = true;
                return Ok(());
            }
            // The same as here: stored below like any version, clean.
            _ => {}
        }
    }
    // `if let … && …`: a local note exists, is not a tombstone, differs from the server's, and
    // is not the same import as the server's.
    if let Some(local) = local
        && !local.note.deleted
        && !local.note.same_as(&server.note)
        && !same_import(conn, &local, &server.note)?
    {
        insert_conflict_copy(conn, &local.note.to_note(), now)?;
        outcome.conflict_copies += 1;
    }
    store(conn, server)?;
    outcome.changed = true;
    Ok(())
}

/// The same backup imported here and on another device (docs/07): the local note was imported
/// here, has never been synced since (`server_rev` 0), and holds the same text as the server's.
/// Only what the other device's triage changed can differ (fuse, trash, color): the server's
/// version wins without a copy, which would otherwise bring a note trashed there back alive.
fn same_import(conn: &Connection, local: &Local, server: &SyncNote) -> Result<bool> {
    let note = &local.note;
    let same_text = !server.deleted
        && note.title == server.title
        && note.content == server.content
        && note.kind == server.kind
        && note.code_language == server.code_language
        && note.pinned == server.pinned
        && note.created_at == server.created_at;
    if local.server_rev != 0 || !same_text {
        return Ok(false);
    }
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM imported_notes WHERE note_id = ?1)",
        [&note.id],
        |row| row.get(0),
    )?)
}

/// Whether the server's version is one this device sent and whose answer was lost.
fn sent_here(unacknowledged: &Unacknowledged, server: &ServerNote) -> bool {
    unacknowledged
        .get(&server.note.id)
        .is_some_and(|versions| versions.iter().any(|sent| sent.same_as(&server.note)))
}

/// Replaces (or adds) the local note with the server's version, which is then in sync. A
/// tombstone removes the note.
fn store(conn: &Connection, server: &ServerNote) -> Result<()> {
    let note = &server.note;
    if note.deleted {
        conn.execute("DELETE FROM notes WHERE id = ?1", [&note.id])?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO notes (id, title, content, kind, code_language, pinned, color,
                            ephemeral_mode, ephemeral_delay_hours, ephemeral_started_at,
                            destroy_at, trashed_at, trash_reason, deleted, created_at, updated_at,
                            server_rev, dirty)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, ?14, ?15, ?16, 0)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title, content = excluded.content, kind = excluded.kind,
           code_language = excluded.code_language, pinned = excluded.pinned,
           color = excluded.color, ephemeral_mode = excluded.ephemeral_mode,
           ephemeral_delay_hours = excluded.ephemeral_delay_hours,
           ephemeral_started_at = excluded.ephemeral_started_at,
           destroy_at = excluded.destroy_at, trashed_at = excluded.trashed_at,
           trash_reason = excluded.trash_reason, deleted = 0,
           created_at = excluded.created_at, updated_at = excluded.updated_at,
           server_rev = excluded.server_rev, dirty = 0",
        params![
            note.id,
            note.title,
            note.content,
            note.kind,
            note.code_language,
            note.pinned,
            note.color,
            note.ephemeral_mode,
            note.ephemeral_delay_hours,
            note.ephemeral_started_at,
            note.destroy_at,
            note.trashed_at,
            note.trash_reason,
            note.created_at,
            note.updated_at,
            server.rev
        ],
    )?;
    Ok(())
}

/// Starts the sync history over (docs/04): another server or account, or a server database
/// recreated or restored. Every note will be sent again, as if it had never been synced;
/// tombstones are dropped (that server never had those notes, or will send them back).
pub fn reset(conn: &Connection, sync_id: &str) -> Result<()> {
    conn.execute("DELETE FROM notes WHERE deleted = 1", [])?;
    conn.execute("UPDATE notes SET server_rev = 0, dirty = 1", [])?;
    config::save_cursor(conn, 0)?;
    config::forget_last_sync(conn)?;
    config::save_sync_id(conn, sync_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::import::{self, ImportedNote};
    use crate::db::notes::{self, NoteColor, NoteKind, NotePatch, TrashReason};
    use crate::db::open_in_memory;
    use crate::sync::protocol::Conflict;

    /// A local note, synced at revision `server_rev` (dirty when 0).
    fn local_note(conn: &Connection, title: &str, server_rev: i64) -> String {
        let note = notes::create(conn, NoteKind::Rich, 1_000).unwrap();
        let patch = NotePatch {
            title: Some(title.to_string()),
            content: Some(format!("contenu de {title}")),
            ..NotePatch::default()
        };
        notes::update(conn, &note.id, patch, 1_000).unwrap();
        if server_rev > 0 {
            conn.execute(
                "UPDATE notes SET server_rev = ?2, dirty = 0 WHERE id = ?1",
                params![note.id, server_rev],
            )
            .unwrap();
        }
        note.id
    }

    fn sync_note(conn: &Connection, id: &str) -> SyncNote {
        local(conn, id).unwrap().unwrap().note
    }

    fn state(conn: &Connection, id: &str) -> Option<(i64, bool)> {
        local(conn, id)
            .unwrap()
            .map(|local| (local.server_rev, local.dirty))
    }

    /// The version a server would send: `note` at revision `rev`.
    fn server(note: SyncNote, rev: i64) -> ServerNote {
        ServerNote { note, rev }
    }

    fn response() -> SyncResponse {
        SyncResponse {
            applied: vec![],
            conflicts: vec![],
            changes: vec![],
            cursor: 0,
            has_more: false,
            server_time: 0,
            sync_id: "s".to_string(),
            reset: false,
        }
    }

    fn titles(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT title FROM notes ORDER BY title")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<String>>>()
            .unwrap()
    }

    #[test]
    fn collects_the_dirty_notes_with_their_last_known_revision() {
        let conn = open_in_memory().unwrap();
        let synced = local_note(&conn, "Synchronisée", 3);
        let edited = local_note(&conn, "Modifiée", 4);
        conn.execute("UPDATE notes SET dirty = 1 WHERE id = ?1", [&edited])
            .unwrap();
        let new = local_note(&conn, "Nouvelle", 0);

        let batch = collect_changes(&conn, MAX_CHANGES, MAX_CHANGE_BYTES).unwrap();

        let sent: Vec<(&str, i64)> = batch
            .changes
            .iter()
            .map(|change| (change.note.id.as_str(), change.base_rev))
            .collect();
        assert!(sent.contains(&(edited.as_str(), 4)));
        assert!(sent.contains(&(new.as_str(), 0)));
        assert!(!sent.iter().any(|(id, _)| *id == synced));
        assert!(!batch.more);
    }

    #[test]
    fn a_batch_stops_at_its_count_or_its_size_but_holds_at_least_one_note() {
        let conn = open_in_memory().unwrap();
        for title in ["a", "b", "c"] {
            local_note(&conn, title, 0);
        }
        let by_count = collect_changes(&conn, 2, MAX_CHANGE_BYTES).unwrap();
        assert_eq!((by_count.changes.len(), by_count.more), (2, true));
        // « a » + « contenu de a »: 14 bytes per note.
        let by_size = collect_changes(&conn, MAX_CHANGES, 30).unwrap();
        assert_eq!((by_size.changes.len(), by_size.more), (2, true));
        let tiny = collect_changes(&conn, MAX_CHANGES, 1).unwrap();
        assert_eq!((tiny.changes.len(), tiny.more), (1, true));
    }

    #[test]
    fn an_accepted_change_is_clean_unless_it_changed_meanwhile() {
        let mut conn = open_in_memory().unwrap();
        let kept = local_note(&conn, "Telle quelle", 0);
        let edited = local_note(&conn, "Avant", 0);
        let sent = collect_changes(&conn, MAX_CHANGES, MAX_CHANGE_BYTES)
            .unwrap()
            .changes;
        // Typed while the request was on its way (even in the same millisecond).
        let patch = NotePatch {
            title: Some("Après".to_string()),
            ..NotePatch::default()
        };
        notes::update(&conn, &edited, patch, 1_000).unwrap();

        let answer = SyncResponse {
            applied: vec![
                Applied {
                    id: kept.clone(),
                    rev: 7,
                },
                Applied {
                    id: edited.clone(),
                    rev: 8,
                },
            ],
            cursor: 8,
            ..response()
        };
        let outcome =
            apply_response(&mut conn, &sent, &answer, 2_000, &Unacknowledged::new()).unwrap();

        assert_eq!(state(&conn, &kept), Some((7, false)));
        assert_eq!(state(&conn, &edited), Some((8, true)));
        assert_eq!(outcome, Outcome::default());
        let config = config::load(&conn).unwrap();
        assert_eq!((config.cursor, config.last_sync_at), (8, Some(2_000)));
    }

    #[test]
    fn an_accepted_deletion_removes_the_tombstone() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "À jeter", 5);
        notes::trash(&conn, &id, 1).unwrap();
        notes::delete_forever(&conn, &id, 2).unwrap();
        let sent = collect_changes(&conn, MAX_CHANGES, MAX_CHANGE_BYTES)
            .unwrap()
            .changes;
        assert!(sent[0].note.deleted);
        assert_eq!(sent[0].note.title, "");

        let answer = SyncResponse {
            applied: vec![Applied {
                id: id.clone(),
                rev: 6,
            }],
            ..response()
        };
        apply_response(&mut conn, &sent, &answer, 3, &Unacknowledged::new()).unwrap();
        assert_eq!(state(&conn, &id), None);
    }

    #[test]
    fn receives_new_notes_changes_and_deletions_from_other_devices() {
        let mut conn = open_in_memory().unwrap();
        let mine = local_note(&conn, "Ancienne version", 2);
        let gone = local_note(&conn, "Supprimée ailleurs", 3);
        let mut updated = sync_note(&conn, &mine);
        updated.title = "Nouvelle version".to_string();
        updated.pinned = true;
        let mut tombstone = sync_note(&conn, &gone);
        tombstone.deleted = true;
        let mut other_device = updated.clone();
        other_device.id = "0192f1c2-0000-7000-8000-00000000000a".to_string();
        other_device.title = "Créée ailleurs".to_string();
        other_device.content = "Pain d'épices".to_string();
        other_device.color = NoteColor::Bleu;

        let answer = SyncResponse {
            changes: vec![
                server(updated.clone(), 9),
                server(tombstone, 10),
                server(other_device.clone(), 11),
            ],
            cursor: 11,
            ..response()
        };
        let outcome =
            apply_response(&mut conn, &[], &answer, 5_000, &Unacknowledged::new()).unwrap();

        assert!(outcome.changed);
        assert_eq!(outcome.conflict_copies, 0);
        assert_eq!(sync_note(&conn, &mine), updated);
        assert_eq!(state(&conn, &mine), Some((9, false)));
        assert_eq!(state(&conn, &gone), None);
        assert_eq!(sync_note(&conn, &other_device.id), other_device);
        assert_eq!(state(&conn, &other_device.id), Some((11, false)));
        // The search index follows.
        let found: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'epices'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(found, 1);
    }

    #[test]
    fn ignores_what_it_already_has() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "À jour", 9);
        let mut older = sync_note(&conn, &id);
        older.title = "Plus ancienne".to_string();
        let mut unknown_tombstone = older.clone();
        unknown_tombstone.id = "0192f1c2-0000-7000-8000-00000000000b".to_string();
        unknown_tombstone.deleted = true;

        let answer = SyncResponse {
            changes: vec![server(older, 9), server(unknown_tombstone, 10)],
            cursor: 10,
            ..response()
        };
        let outcome = apply_response(&mut conn, &[], &answer, 0, &Unacknowledged::new()).unwrap();

        assert!(!outcome.changed);
        assert_eq!(titles(&conn), ["À jour"]);
    }

    #[test]
    fn a_conflict_keeps_the_local_version_as_a_copy() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "Courses", 4);
        let patch = NotePatch {
            content: Some("Version d'ici".to_string()),
            ..NotePatch::default()
        };
        notes::update(&conn, &id, patch, 2_000).unwrap();
        let sent = collect_changes(&conn, MAX_CHANGES, MAX_CHANGE_BYTES)
            .unwrap()
            .changes;
        let mut theirs = sync_note(&conn, &id);
        theirs.content = "Version d'ailleurs".to_string();

        let answer = SyncResponse {
            conflicts: vec![Conflict {
                id: id.clone(),
                server: server(theirs.clone(), 6),
            }],
            changes: vec![server(theirs.clone(), 6)],
            cursor: 6,
            ..response()
        };
        let outcome =
            apply_response(&mut conn, &sent, &answer, 3_000, &Unacknowledged::new()).unwrap();

        assert_eq!(
            outcome,
            Outcome {
                changed: true,
                conflict_copies: 1,
                resend: false,
            }
        );
        assert_eq!(sync_note(&conn, &id), theirs);
        assert_eq!(state(&conn, &id), Some((6, false)));
        let (copy_id, title, content, server_rev, dirty): (String, String, String, i64, bool) =
            conn.query_row(
                "SELECT id, title, content, server_rev, dirty FROM notes WHERE id != ?1",
                [&id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_ne!(copy_id, id);
        assert!(title.starts_with("Courses (conflit du "), "{title}");
        assert_eq!(
            (content.as_str(), server_rev, dirty),
            ("Version d'ici", 0, true)
        );
    }

    #[test]
    fn a_change_received_for_a_note_modified_here_is_a_conflict_too() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "Courses", 4);
        // Modified here, not sent yet (beyond the batch, or typed during the request).
        let patch = NotePatch {
            content: Some("Ici".to_string()),
            ..NotePatch::default()
        };
        notes::update(&conn, &id, patch, 2_000).unwrap();
        let mut theirs = sync_note(&conn, &id);
        theirs.content = "Ailleurs".to_string();

        let answer = SyncResponse {
            changes: vec![server(theirs, 5)],
            cursor: 5,
            ..response()
        };
        let outcome =
            apply_response(&mut conn, &[], &answer, 3_000, &Unacknowledged::new()).unwrap();

        assert_eq!(outcome.conflict_copies, 1);
        assert_eq!(sync_note(&conn, &id).content, "Ailleurs");
        assert_eq!(titles(&conn).len(), 2);
    }

    #[test]
    fn no_copy_when_both_sides_hold_the_same_note() {
        // Both sides burnt the same fuse, at different moments.
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "Courses", 4);
        conn.execute(
            "UPDATE notes SET trashed_at = 10, trash_reason = 'self_destruct', updated_at = 99,
                    dirty = 1 WHERE id = ?1",
            [&id],
        )
        .unwrap();
        let theirs = SyncNote {
            updated_at: 50,
            ..sync_note(&conn, &id)
        };

        let answer = SyncResponse {
            changes: vec![server(theirs, 5)],
            ..response()
        };
        let outcome =
            apply_response(&mut conn, &[], &answer, 3_000, &Unacknowledged::new()).unwrap();

        assert_eq!(outcome.conflict_copies, 0);
        assert_eq!(state(&conn, &id), Some((5, false)));
    }

    /// The same backup imported on this device: one note, never synced, as in docs/07.
    fn imported_note(conn: &mut Connection) -> String {
        let note = ImportedNote {
            source_id: "6f1c3a52-9d4e-4b8a-a1f0-2c3d4e5f6a7b".to_string(),
            title: "Courses".to_string(),
            content: "- [ ] Lait".to_string(),
            kind: NoteKind::Rich,
            code_language: None,
            pinned: false,
            created_at: 1_000,
            updated_at: 2_000,
        };
        import::import_notes(conn, vec![note], 5_000).unwrap();
        "6f1c3a52-9d4e-4b8a-a1f0-2c3d4e5f6a7b".to_string()
    }

    /// The conflict answered to this device's first sync, the server holding `theirs`.
    fn first_sync(conn: &mut Connection, theirs: &SyncNote) -> Outcome {
        let sent = collect_changes(conn, MAX_CHANGES, MAX_CHANGE_BYTES)
            .unwrap()
            .changes;
        let answer = SyncResponse {
            conflicts: vec![Conflict {
                id: theirs.id.clone(),
                server: server(theirs.clone(), 3),
            }],
            changes: vec![server(theirs.clone(), 3)],
            cursor: 3,
            ..response()
        };
        apply_response(conn, &sent, &answer, 9_000, &Unacknowledged::new()).unwrap()
    }

    #[test]
    fn the_same_backup_imported_on_another_device_makes_no_copy() {
        // Another device imported the same backup, trashed the note in its triage, and synced
        // first (review, phase 4). Same text: only the triage differs, and the server's version
        // wins without a copy, instead of bringing the trashed note back alive.
        let mut conn = open_in_memory().unwrap();
        let id = imported_note(&mut conn);
        let theirs = SyncNote {
            trashed_at: Some(4_000),
            trash_reason: Some(TrashReason::Manual),
            updated_at: 4_000,
            ..sync_note(&conn, &id)
        };

        let outcome = first_sync(&mut conn, &theirs);

        assert_eq!(outcome.conflict_copies, 0);
        assert_eq!(sync_note(&conn, &id), theirs);
        assert_eq!(state(&conn, &id), Some((3, false)));
        assert_eq!(titles(&conn), vec!["Courses"]);
    }

    #[test]
    fn an_imported_note_changed_here_before_its_first_sync_keeps_a_copy() {
        let mut conn = open_in_memory().unwrap();
        let id = imported_note(&mut conn);
        let theirs = SyncNote {
            trashed_at: Some(4_000),
            trash_reason: Some(TrashReason::Manual),
            ..sync_note(&conn, &id)
        };
        let patch = NotePatch {
            content: Some("- [ ] Lait\n- [ ] Pain".to_string()),
            ..NotePatch::default()
        };
        notes::update(&conn, &id, patch, 6_000).unwrap();

        let outcome = first_sync(&mut conn, &theirs);

        assert_eq!(outcome.conflict_copies, 1);
        assert_eq!(sync_note(&conn, &id), theirs);
        assert_eq!(titles(&conn).len(), 2);
    }

    #[test]
    fn a_local_tombstone_in_conflict_lets_the_note_come_back_without_a_copy() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "Courses", 4);
        let mut theirs = sync_note(&conn, &id);
        theirs.title = "Modifiée ailleurs".to_string();
        notes::trash(&conn, &id, 1).unwrap();
        notes::delete_forever(&conn, &id, 2).unwrap();
        let sent = collect_changes(&conn, MAX_CHANGES, MAX_CHANGE_BYTES)
            .unwrap()
            .changes;

        let answer = SyncResponse {
            conflicts: vec![Conflict {
                id: id.clone(),
                server: server(theirs, 6),
            }],
            ..response()
        };
        let outcome = apply_response(&mut conn, &sent, &answer, 3, &Unacknowledged::new()).unwrap();

        assert_eq!(outcome.conflict_copies, 0);
        assert_eq!(titles(&conn), ["Modifiée ailleurs"]);
        assert_eq!(notes::get(&conn, &id).unwrap().trashed_at, None);
    }

    #[test]
    fn a_note_deleted_elsewhere_and_modified_here_survives_as_a_copy() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "Courses", 4);
        let patch = NotePatch {
            content: Some("Encore utile".to_string()),
            ..NotePatch::default()
        };
        notes::update(&conn, &id, patch, 2_000).unwrap();
        let tombstone = SyncNote {
            deleted: true,
            title: String::new(),
            content: String::new(),
            ..sync_note(&conn, &id)
        };

        let answer = SyncResponse {
            changes: vec![server(tombstone, 5)],
            ..response()
        };
        apply_response(&mut conn, &[], &answer, 3_000, &Unacknowledged::new()).unwrap();

        assert_eq!(state(&conn, &id), None);
        let content: String = conn
            .query_row("SELECT content FROM notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(content, "Encore utile");
    }

    #[test]
    fn a_note_deleted_for_good_while_it_was_being_sent_leaves_a_tombstone() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "Jamais synchronisée", 0);
        notes::trash(&conn, &id, 1).unwrap();
        let sent = collect_changes(&conn, MAX_CHANGES, MAX_CHANGE_BYTES)
            .unwrap()
            .changes;
        // Emptied from the trash during the request: never synced, so removed without tombstone.
        notes::delete_forever(&conn, &id, 2).unwrap();
        assert_eq!(state(&conn, &id), None);

        let answer = SyncResponse {
            applied: vec![Applied {
                id: id.clone(),
                rev: 7,
            }],
            ..response()
        };
        apply_response(&mut conn, &sent, &answer, 3, &Unacknowledged::new()).unwrap();

        // The server stored it: its deletion is still to be sent.
        assert_eq!(state(&conn, &id), Some((7, true)));
        let tombstone = sync_note(&conn, &id);
        assert!(tombstone.deleted);
        assert_eq!(
            (tombstone.title.as_str(), tombstone.content.as_str()),
            ("", "")
        );
        let next = collect_changes(&conn, MAX_CHANGES, MAX_CHANGE_BYTES).unwrap();
        assert_eq!(next.changes[0].base_rev, 7);
        // Invisible: tombstones are never listed.
        assert!(notes::get(&conn, &id).is_err());
    }

    #[test]
    fn its_own_version_coming_back_after_a_lost_answer_is_not_a_conflict() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "Courses", 4);
        let patch = NotePatch {
            content: Some("Version envoyée".to_string()),
            ..NotePatch::default()
        };
        notes::update(&conn, &id, patch, 2_000).unwrap();
        // Sent; the server applied it at revision 5, but the answer was lost.
        let lost = sync_note(&conn, &id);
        let mut unacknowledged = Unacknowledged::new();
        unacknowledged.insert(id.clone(), vec![lost.clone()]);
        // Typed since then.
        let patch = NotePatch {
            content: Some("Version plus récente".to_string()),
            ..NotePatch::default()
        };
        notes::update(&conn, &id, patch, 3_000).unwrap();

        let answer = SyncResponse {
            conflicts: vec![Conflict {
                id: id.clone(),
                server: server(lost.clone(), 5),
            }],
            changes: vec![server(lost, 5)],
            ..response()
        };
        let outcome = apply_response(&mut conn, &[], &answer, 4_000, &unacknowledged).unwrap();

        // Nothing changed on screen, no copy, but the newer version goes at once.
        assert_eq!(
            outcome,
            Outcome {
                resend: true,
                ..Outcome::default()
            }
        );
        assert_eq!(titles(&conn).len(), 1);
        assert_eq!(sync_note(&conn, &id).content, "Version plus récente");
        // Goes on from the revision the server has: the next push is a plain update.
        assert_eq!(state(&conn, &id), Some((5, true)));
    }

    #[test]
    fn a_note_deleted_for_good_after_a_lost_answer_does_not_come_back() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "Jamais synchronisée", 0);
        // Sent; the server stored it at revision 5, but the answer was lost.
        let lost = sync_note(&conn, &id);
        let mut unacknowledged = Unacknowledged::new();
        unacknowledged.insert(id.clone(), vec![lost.clone()]);
        // Deleted for good since: never synced, so removed without a tombstone.
        notes::trash(&conn, &id, 2_000).unwrap();
        notes::delete_forever(&conn, &id, 2_001).unwrap();

        // The server sends it back, as a change or as a conflict.
        for answer in [
            SyncResponse {
                changes: vec![server(lost.clone(), 5)],
                ..response()
            },
            SyncResponse {
                conflicts: vec![Conflict {
                    id: id.clone(),
                    server: server(lost.clone(), 5),
                }],
                ..response()
            },
        ] {
            conn.execute("DELETE FROM notes", []).unwrap();
            let outcome = apply_response(&mut conn, &[], &answer, 3_000, &unacknowledged).unwrap();

            assert!(outcome.resend && !outcome.changed);
            // Not back: a tombstone at the server's revision, to be sent.
            assert!(notes::get(&conn, &id).is_err());
            assert_eq!(state(&conn, &id), Some((5, true)));
            assert!(sync_note(&conn, &id).deleted);
        }
    }

    #[test]
    fn its_own_version_coming_back_unchanged_is_stored_clean() {
        let mut conn = open_in_memory().unwrap();
        let id = local_note(&conn, "Courses", 4);
        let patch = NotePatch {
            content: Some("Version envoyée".to_string()),
            ..NotePatch::default()
        };
        notes::update(&conn, &id, patch, 2_000).unwrap();
        let lost = sync_note(&conn, &id);
        let mut unacknowledged = Unacknowledged::new();
        unacknowledged.insert(id.clone(), vec![lost.clone()]);

        // Not edited since: the server's version is the one here.
        let answer = SyncResponse {
            changes: vec![server(lost, 5)],
            ..response()
        };
        let outcome = apply_response(&mut conn, &[], &answer, 4_000, &unacknowledged).unwrap();

        assert!(!outcome.resend);
        assert_eq!(state(&conn, &id), Some((5, false)));
    }

    #[test]
    fn a_reset_sends_everything_again_from_the_start() {
        let conn = open_in_memory().unwrap();
        let synced = local_note(&conn, "Synchronisée", 3);
        let tombstone = local_note(&conn, "Supprimée", 4);
        notes::trash(&conn, &tombstone, 1).unwrap();
        notes::delete_forever(&conn, &tombstone, 2).unwrap();
        config::save_cursor(&conn, 4).unwrap();

        reset(&conn, "nouvelle").unwrap();

        assert_eq!(state(&conn, &synced), Some((0, true)));
        assert_eq!(state(&conn, &tombstone), None);
        let config = config::load(&conn).unwrap();
        assert_eq!(
            (config.cursor, config.sync_id.as_deref()),
            (0, Some("nouvelle"))
        );
    }
}
