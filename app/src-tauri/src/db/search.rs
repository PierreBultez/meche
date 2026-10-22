//! Full-text search with SQLite FTS5 (docs/03, "Requêtes de recherche").

use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, params};
use serde::Serialize;

use super::notes::{Entities, NoteColor, NoteKind, list_texts, markdown_line_to_text};
use crate::error::Result;

/// Marks the start and end of each match in excerpts. They are "private use" Unicode
/// characters that never appear in notes. The frontend turns them into highlights itself, so
/// the note text is never interpreted as HTML (no injection, unlike `<mark>` tags).
pub const MATCH_START: &str = "\u{E000}";
pub const MATCH_END: &str = "\u{E001}";

const MAX_RESULTS: i64 = 50;
const EXCERPT_TOKENS: i64 = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    /// The title, or the first line of the content when the title is empty.
    pub title: String,
    /// A few words around the matches, which are wrapped in MATCH_START / MATCH_END.
    pub excerpt: String,
    pub kind: NoteKind,
    pub color: NoteColor,
    pub pinned: bool,
    pub updated_at: i64,
}

/// Registers the SQL functions the schema needs: the view and the triggers of migration 002
/// call `rich_search_text`. SQLite forgets them when a connection closes, so this runs on every
/// connection, before the migrations.
pub fn register_functions(conn: &Connection) -> Result<()> {
    // The function never changes anything and always gives the same result for the same text:
    // DETERMINISTIC and INNOCUOUS let SQLite use it in a view and in triggers.
    let flags = FunctionFlags::SQLITE_UTF8
        | FunctionFlags::SQLITE_DETERMINISTIC
        | FunctionFlags::SQLITE_INNOCUOUS;
    // `|context| { … }` is a closure: a small function written inline, called by SQLite with
    // the arguments of each call.
    conn.create_scalar_function("rich_search_text", 1, flags, |context| {
        let content: String = context.get(0)?;
        Ok(rich_search_text(&content))
    })?;
    Ok(())
}

/// The text of a rich note as the search index reads it (migration 002). The HTML entities the
/// editor writes (`&amp;`, `&lt;`…) are decoded, except in code (fenced blocks and inline code),
/// which the editor stores as typed. A decoded ">" is written "\>": the excerpts, which strip
/// Markdown, must not take it for a quote marker.
pub fn rich_search_text(markdown: &str) -> String {
    let mut out = String::with_capacity(markdown.len());
    // The fence of the code block we are in, if any: its character and its length.
    let mut fence: Option<(char, usize)> = None;
    for (index, line) in markdown.split('\n').enumerate() {
        if index > 0 {
            out.push('\n');
        }
        match fence {
            Some((character, length)) => {
                if closes_fence(line, character, length) {
                    fence = None;
                }
                out.push_str(line);
            }
            None => match opening_fence(line) {
                Some(opened) => {
                    fence = Some(opened);
                    out.push_str(line);
                }
                None => out.push_str(&decode_outside_code_spans(line)),
            },
        }
    }
    out
}

/// "```php" or "~~~": the character and the length of the fence that opens a code block.
fn opening_fence(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    let character = trimmed.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let length = trimmed.chars().take_while(|c| *c == character).count();
    (length >= 3).then_some((character, length))
}

/// A line made only of the same fence character, at least as long as the opening one.
fn closes_fence(line: &str, character: char, length: usize) -> bool {
    let trimmed = line.trim();
    trimmed.chars().count() >= length && trimmed.chars().all(|c| c == character)
}

/// Decodes the entities of a line, leaving `inline code` as it is.
fn decode_outside_code_spans(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut text = String::new();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            // An escaped character ("\`") is text, never the start of code.
            '\\' if i + 1 < chars.len() => {
                text.push(chars[i]);
                text.push(chars[i + 1]);
                i += 2;
            }
            '`' => {
                let run = chars[i..].iter().take_while(|c| **c == '`').count();
                let end = closing_backticks(&chars, i + run, run).unwrap_or(i + run);
                out.push_str(&decode_entities(&text));
                text.clear();
                // The code span with its backticks, or the backticks alone if it never closes.
                out.extend(&chars[i..end]);
                i = end;
            }
            c => {
                text.push(c);
                i += 1;
            }
        }
    }
    out.push_str(&decode_entities(&text));
    out
}

/// Where a code span opened by `run` backticks ends: just after the next run of exactly `run`
/// backticks starting at `from` or later.
fn closing_backticks(chars: &[char], from: usize, run: usize) -> Option<usize> {
    let mut i = from;
    while i < chars.len() {
        if chars[i] == '`' {
            let length = chars[i..].iter().take_while(|c| **c == '`').count();
            if length == run {
                return Some(i + length);
            }
            i += length;
        } else {
            i += 1;
        }
    }
    None
}

/// The entities written by the editor, decoded; "&amp;" last, since "&amp;lt;" is the text
/// "&lt;", not "<".
fn decode_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&#32;", " ")
        .replace("&#9;", "\t")
        .replace("&lt;", "<")
        .replace("&gt;", "\\>")
        .replace("&amp;", "&")
}

/// Turns what the user typed into an FTS5 prefix query: `cour lidl` → `"cour"* "lidl"*`.
///
/// Each word is quoted (inner quotes doubled), so characters that mean something to FTS5
/// (`-`, `*`, `(`, `NEAR`, `AND`…) are searched as plain text and never cause a syntax error.
/// Words without any letter or digit are dropped: FTS5 would ignore them anyway.
pub fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .filter(|word| word.chars().any(char::is_alphanumeric))
        .map(|word| format!("\"{}\"*", word.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

/// Notes (outside the trash) matching every word of `input`, best matches first: a match in
/// the title counts 5 times more than one in the content.
pub fn search(conn: &Connection, input: &str) -> Result<Vec<SearchResult>> {
    let Some(query) = fts_query(input) else {
        return Ok(Vec::new());
    };
    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, substr(n.content, 1, 400), n.kind, n.color, n.pinned,
                n.updated_at, snippet(notes_fts, -1, ?2, ?3, '…', ?4)
         FROM notes_fts JOIN notes n ON n.seq = notes_fts.rowid
         WHERE notes_fts MATCH ?1 AND n.deleted = 0 AND n.trashed_at IS NULL
         ORDER BY bm25(notes_fts, 5.0, 1.0)
         LIMIT ?5",
    )?;
    let results = stmt
        .query_map(
            params![query, MATCH_START, MATCH_END, EXCERPT_TOKENS, MAX_RESULTS],
            |row| {
                let kind: NoteKind = row.get(3)?;
                let stored_title: String = row.get(1)?;
                let content_start: String = row.get(2)?;
                let snippet: String = row.get(7)?;
                let (title, _) = list_texts(&stored_title, &content_start, kind);
                Ok(SearchResult {
                    id: row.get(0)?,
                    title,
                    excerpt: excerpt_text(&snippet, kind),
                    kind,
                    color: row.get(4)?,
                    pinned: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(results)
}

/// One line of plain text from a snippet: Markdown syntax removed for rich notes, whitespace
/// collapsed for code notes. The match markers are kept.
fn excerpt_text(snippet: &str, kind: NoteKind) -> String {
    let lines: Vec<String> = match kind {
        // The index reads rich notes with their HTML entities already decoded (migration 002).
        NoteKind::Rich => snippet
            .lines()
            .filter_map(|line| markdown_line_to_text(line, Entities::Decoded))
            .collect(),
        NoteKind::Code => snippet.lines().map(str::to_string).collect(),
    };
    lines
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::{NotePatch, create, trash, update};
    use crate::db::open_in_memory;

    fn note(conn: &Connection, title: &str, content: &str) -> String {
        let id = create(conn, NoteKind::Rich, 0).unwrap().id;
        let patch = NotePatch {
            title: Some(title.to_string()),
            content: Some(content.to_string()),
            ..NotePatch::default()
        };
        update(conn, &id, patch, 0).unwrap();
        id
    }

    fn found(conn: &Connection, input: &str) -> Vec<String> {
        search(conn, input)
            .unwrap()
            .into_iter()
            .map(|result| result.id)
            .collect()
    }

    #[test]
    fn builds_prefix_queries_with_quoted_words() {
        assert_eq!(
            fts_query("cour lidl").as_deref(),
            Some(r#""cour"* "lidl"*"#)
        );
        assert_eq!(
            fts_query(r#"dit "bonjour""#).as_deref(),
            Some(r#""dit"* """bonjour"""*"#)
        );
        assert_eq!(fts_query("  - * ( "), None);
        assert_eq!(fts_query(""), None);
    }

    #[test]
    fn finds_words_by_prefix_while_typing() {
        let conn = open_in_memory().unwrap();
        let courses = note(&conn, "Courses", "Lait et pain au Lidl");
        note(&conn, "Serveur", "Apache et certbot");
        assert_eq!(found(&conn, "cour"), [courses.as_str()]);
        assert_eq!(found(&conn, "lid"), [courses]);
    }

    #[test]
    fn every_word_must_match() {
        let conn = open_in_memory().unwrap();
        let both = note(&conn, "", "lait et pain");
        note(&conn, "", "lait seulement");
        assert_eq!(found(&conn, "lait pain"), [both]);
    }

    #[test]
    fn ignores_accents_and_case() {
        let conn = open_in_memory().unwrap();
        let id = note(&conn, "Réunion", "À l'École de Noël");
        assert_eq!(found(&conn, "reunion"), [id.as_str()]);
        assert_eq!(found(&conn, "ECOLE"), [id.as_str()]);
        assert_eq!(found(&conn, "noël"), [id]);
    }

    #[test]
    fn special_characters_never_break_the_query() {
        let conn = open_in_memory().unwrap();
        note(&conn, "", "a-b c*d (e) \"f\" NEAR AND OR NOT");
        for input in [
            "a-b", "c*d", "(e)", "\"f\"", "NEAR", "AND OR", "NOT", "\"", "'", "^", ":",
        ] {
            assert!(search(&conn, input).is_ok(), "query {input:?} failed");
        }
        assert_eq!(found(&conn, "NEAR").len(), 1);
    }

    #[test]
    fn title_matches_rank_first() {
        let conn = open_in_memory().unwrap();
        let in_content = note(&conn, "Divers", "penser au certificat certbot");
        let in_title = note(&conn, "Certbot", "renouvellement");
        assert_eq!(found(&conn, "certbot"), [in_title, in_content]);
    }

    #[test]
    fn trashed_notes_are_not_found() {
        let conn = open_in_memory().unwrap();
        let id = note(&conn, "Courses", "lait");
        trash(&conn, &id, 1).unwrap();
        assert!(found(&conn, "lait").is_empty());
    }

    #[test]
    fn excerpts_mark_the_matches_without_markdown() {
        let conn = open_in_memory().unwrap();
        note(
            &conn,
            "Mémo",
            "- [ ] Renouveler le **certificat** avec `certbot`",
        );
        let result = &search(&conn, "certif").unwrap()[0];
        assert_eq!(result.title, "Mémo");
        assert_eq!(
            result.excerpt,
            format!("Renouveler le {MATCH_START}certificat{MATCH_END} avec certbot")
        );
    }

    #[test]
    fn search_text_decodes_entities_outside_code_only() {
        let markdown =
            "Pierre &amp; Marie -&gt; ok\n```html\n<td>&nbsp;</td>\n```\nCode `&amp;` et &lt;b&gt;";
        assert_eq!(
            rich_search_text(markdown),
            "Pierre & Marie -\\> ok\n```html\n<td>&nbsp;</td>\n```\nCode `&amp;` et <b\\>"
        );
        // An unclosed code span is only backticks: the rest is still decoded.
        assert_eq!(rich_search_text("a ` b &amp; c"), "a ` b & c");
        // "&amp;lt;" is the text "&lt;".
        assert_eq!(rich_search_text("&amp;lt;"), "&lt;");
    }

    #[test]
    fn entities_in_code_are_still_found() {
        let conn = open_in_memory().unwrap();
        let id = note(&conn, "", "```html\n<td>&nbsp;</td>\n```");
        assert_eq!(found(&conn, "nbsp"), [id]);
    }

    #[test]
    fn an_escaped_quote_marker_stays_in_the_excerpt() {
        let conn = open_in_memory().unwrap();
        note(&conn, "", "&gt; pas une citation et -&gt; suite");
        let result = &search(&conn, "citation").unwrap()[0];
        assert_eq!(
            result.excerpt,
            format!("> pas une {MATCH_START}citation{MATCH_END} et -> suite")
        );
    }

    #[test]
    fn entity_names_are_neither_found_nor_shown() {
        let conn = open_in_memory().unwrap();
        note(&conn, "", "Pierre &amp; Marie, a -&gt; b");
        assert!(found(&conn, "amp").is_empty());
        assert!(found(&conn, "gt").is_empty());
        let result = &search(&conn, "mari").unwrap()[0];
        assert_eq!(
            result.excerpt,
            format!("Pierre & {MATCH_START}Marie{MATCH_END}, a -> b")
        );
    }

    #[test]
    fn excerpts_keep_html_as_plain_text() {
        let conn = open_in_memory().unwrap();
        note(
            &conn,
            "",
            "le texte &lt;script&gt;alert(1)&lt;/script&gt; reste du texte",
        );
        let result = &search(&conn, "alert").unwrap()[0];
        assert!(result.excerpt.contains("<script>"));
        assert!(
            result
                .excerpt
                .contains(&format!("{MATCH_START}alert{MATCH_END}"))
        );
    }
}

/// Performance budget of docs/08: a search under 30 ms with 1,000 notes.
/// Ignored by default (a debug build is much slower); run it in release mode:
/// `cargo test --release -- --ignored --nocapture`
#[cfg(test)]
mod performance {
    use std::time::{Duration, Instant};

    use super::*;
    use crate::db::notes::{ListFilter, NotePatch, create, list, update};

    const WORDS: [&str; 12] = [
        "lait", "pain", "serveur", "apache", "certbot", "laravel", "école", "réunion", "facture",
        "rust", "vue", "tauri",
    ];

    #[test]
    #[ignore]
    fn search_and_list_stay_fast_with_1000_notes() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_in_dir(dir.path()).unwrap();
        for i in 0..1000_usize {
            let id = create(&conn, NoteKind::Rich, i as i64).unwrap().id;
            let words: Vec<&str> = (0..300)
                .map(|j| WORDS[(i * 7 + j * 13) % WORDS.len()])
                .collect();
            let patch = NotePatch {
                title: Some(format!("Note {i} {}", WORDS[i % WORDS.len()])),
                content: Some(format!("# Titre\n\n- [ ] {}\n", words.join(" "))),
                ..NotePatch::default()
            };
            update(&conn, &id, patch, i as i64).unwrap();
        }

        for query in [
            "la",
            "lait",
            "serv",
            "ecole",
            "reunion pain",
            "tauri vue",
            "zzz",
        ] {
            let start = Instant::now();
            let count = search(&conn, query).unwrap().len();
            let elapsed = start.elapsed();
            println!("search {query:?}: {count} results in {elapsed:?}");
            assert!(
                elapsed < Duration::from_millis(30),
                "search {query:?} took {elapsed:?}"
            );
        }
        let start = Instant::now();
        let count = list(&conn, ListFilter::All).unwrap().len();
        println!(
            "list_notes(all): {count} summaries in {:?}",
            start.elapsed()
        );
    }
}
