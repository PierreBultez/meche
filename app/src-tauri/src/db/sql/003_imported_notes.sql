-- Migration 003: import from Standard Notes (phase 4, docs/07).
-- Every imported note, by its id in the backup (the Standard Notes uuid). Importing the same
-- backup again skips these notes, even the ones deleted since: a note thrown away during the
-- triage never comes back. Local only, never synced.
-- No foreign key to `notes`: the row must outlive its note (purged from the trash).
CREATE TABLE imported_notes (
  source_id   TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL,
  imported_at INTEGER NOT NULL
);
