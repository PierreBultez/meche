-- Migration 002: the search index reads rich notes as they are shown.
-- The editor stores '&', '<', '>' as the HTML entities &amp; &lt; &gt;, a lone space as &nbsp;
-- and a space or tab starting a line as &#32; or &#9;. Indexed as such, typing "amp" or "gt"
-- found every note containing '&' or '>'. The index now reads the view below, where
-- rich_search_text() decodes these entities, except in code, which the editor stores as typed.
-- rich_search_text() is a Rust function (db/search.rs), registered on every connection before
-- the migrations run. The view and the triggers must give exactly the same text, otherwise FTS5
-- can neither remove an old entry nor place the highlights of an excerpt.

DROP TRIGGER notes_ai;
DROP TRIGGER notes_ad;
DROP TRIGGER notes_au;
DROP TABLE notes_fts;

CREATE VIEW notes_search (seq, title, content) AS
  SELECT seq, title,
         CASE WHEN kind = 'rich' THEN rich_search_text(content) ELSE content END
  FROM notes;

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content,
  content='notes_search', content_rowid='seq',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title,
    CASE WHEN new.kind = 'rich' THEN rich_search_text(new.content) ELSE new.content END);
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title,
    CASE WHEN old.kind = 'rich' THEN rich_search_text(old.content) ELSE old.content END);
END;

-- A conversion (kind) changes the content too, but it is listed for safety.
CREATE TRIGGER notes_au AFTER UPDATE OF title, content, kind ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title,
    CASE WHEN old.kind = 'rich' THEN rich_search_text(old.content) ELSE old.content END);
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title,
    CASE WHEN new.kind = 'rich' THEN rich_search_text(new.content) ELSE new.content END);
END;

-- Index the existing notes again, from the view.
INSERT INTO notes_fts(notes_fts) VALUES ('rebuild');
