-- Migration 001: initial local schema (docs/03-modele-donnees.md).
-- Never edit this file once it has shipped: add a new migration instead.

CREATE TABLE notes (
  -- Local-only integer key, used by the full-text index (notes_fts) to point at its row.
  -- An explicit INTEGER PRIMARY KEY never changes, even after VACUUM; the implicit rowid of a
  -- table without one could, which would silently break search results.
  seq                    INTEGER PRIMARY KEY,
  id                     TEXT    NOT NULL UNIQUE,
  title                  TEXT    NOT NULL DEFAULT '',
  content                TEXT    NOT NULL DEFAULT '',
  kind                   TEXT    NOT NULL DEFAULT 'rich' CHECK (kind IN ('rich','code')),
  code_language          TEXT,
  pinned                 INTEGER NOT NULL DEFAULT 0,
  color                  TEXT    NOT NULL DEFAULT 'violet'
                         CHECK (color IN ('violet','rose','corail','orange','citron','pomme','turquoise','bleu')),
  ephemeral_mode         TEXT CHECK (ephemeral_mode IN ('delay','on_complete')),
  ephemeral_delay_hours  INTEGER,
  ephemeral_started_at   INTEGER,
  destroy_at             INTEGER,
  trashed_at             INTEGER,
  trash_reason           TEXT CHECK (trash_reason IN ('manual','self_destruct')),
  deleted                INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  server_rev             INTEGER NOT NULL DEFAULT 0,
  dirty                  INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_notes_list    ON notes (deleted, trashed_at, pinned DESC, updated_at DESC);
CREATE INDEX idx_notes_destroy ON notes (destroy_at) WHERE destroy_at IS NOT NULL AND trashed_at IS NULL;
CREATE INDEX idx_notes_dirty   ON notes (dirty) WHERE dirty = 1;

-- Full-text search (external-content table kept in sync by the triggers below).
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content,
  content='notes', content_rowid='seq',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title, new.content);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title, old.content);
END;
CREATE TRIGGER notes_au AFTER UPDATE OF title, content ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title, old.content);
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title, new.content);
END;

-- Local settings and sync state (key / JSON value).
-- Keys: server_url, api_token, device_name, sync_cursor, last_sync_at,
--       default_delay_hours_delay (168), default_delay_hours_on_complete (24),
--       theme ('system'|'light'|'dark')
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Notes waiting to be sorted after a Standard Notes import (local only).
CREATE TABLE import_triage (
  note_id   TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL
);
