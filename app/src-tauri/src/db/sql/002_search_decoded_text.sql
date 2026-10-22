-- Migration 002: the search index reads rich notes as they are shown.
-- The editor stores '&', '<', '>' as the HTML entities &amp; &lt; &gt;, a lone space as &nbsp;
-- and a space or tab starting a line as &#32; or &#9;. Indexed as such, typing "amp" or "gt" found every note containing '&' or '>'.
-- The index now reads a view where these entities are decoded. The decoding is written twice,
-- in the view and in the triggers: both must stay identical, otherwise FTS5 cannot remove an
-- old entry nor place the highlights of an excerpt.

DROP TRIGGER notes_ai;
DROP TRIGGER notes_ad;
DROP TRIGGER notes_au;
DROP TABLE notes_fts;

CREATE VIEW notes_search (seq, title, content) AS
  SELECT seq, title,
         CASE WHEN kind = 'rich'
              THEN replace(replace(replace(replace(replace(replace(content,
                     '&nbsp;', ' '), '&#32;', ' '), '&#9;', char(9)),
                     '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
              ELSE content
         END
  FROM notes;

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content,
  content='notes_search', content_rowid='seq',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title,
    CASE WHEN new.kind = 'rich'
         THEN replace(replace(replace(replace(replace(replace(new.content,
                '&nbsp;', ' '), '&#32;', ' '), '&#9;', char(9)),
                '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
         ELSE new.content
    END);
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title,
    CASE WHEN old.kind = 'rich'
         THEN replace(replace(replace(replace(replace(replace(old.content,
                '&nbsp;', ' '), '&#32;', ' '), '&#9;', char(9)),
                '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
         ELSE old.content
    END);
END;

-- A conversion (kind) changes the content too, but it is listed for safety.
CREATE TRIGGER notes_au AFTER UPDATE OF title, content, kind ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title,
    CASE WHEN old.kind = 'rich'
         THEN replace(replace(replace(replace(replace(replace(old.content,
                '&nbsp;', ' '), '&#32;', ' '), '&#9;', char(9)),
                '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
         ELSE old.content
    END);
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title,
    CASE WHEN new.kind = 'rich'
         THEN replace(replace(replace(replace(replace(replace(new.content,
                '&nbsp;', ' '), '&#32;', ' '), '&#9;', char(9)),
                '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
         ELSE new.content
    END);
END;

-- Index the existing notes again, from the view.
INSERT INTO notes_fts(notes_fts) VALUES ('rebuild');
