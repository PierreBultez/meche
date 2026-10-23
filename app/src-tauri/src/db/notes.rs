//! Notes: the types shared with the frontend and the queries that read and write them (docs/03).

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::ephemeral;
use crate::error::{Error, Result};

/// Limits of docs/03 ("Limites").
pub const MAX_TITLE_CHARS: usize = 500;
pub const MAX_CONTENT_BYTES: usize = 2 * 1024 * 1024;

/// Characters of content read from the database to build a list preview: `list` never loads
/// whole notes (docs/08, performance).
const PREVIEW_SOURCE_CHARS: i64 = 400;
const PREVIEW_MAX_CHARS: usize = 140;

// ── Small enums stored as text ─────────────────────────────────────────────────────────────
//
// Each enum is sent to the frontend as a lowercase string (serde) and stored in SQLite as the
// same string. `ToSql` / `FromSql` are the rusqlite traits that convert a Rust value to and
// from a column value; implementing them lets us pass these enums straight to queries.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    Rich,
    Code,
}

impl NoteKind {
    fn as_str(self) -> &'static str {
        match self {
            NoteKind::Rich => "rich",
            NoteKind::Code => "code",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "rich" => Some(NoteKind::Rich),
            "code" => Some(NoteKind::Code),
            _ => None,
        }
    }
}

/// The 8 note colors (docs/11). Stored by name so that each theme applies its own shade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteColor {
    Violet,
    Rose,
    Corail,
    Orange,
    Citron,
    Pomme,
    Turquoise,
    Bleu,
}

impl NoteColor {
    fn as_str(self) -> &'static str {
        match self {
            NoteColor::Violet => "violet",
            NoteColor::Rose => "rose",
            NoteColor::Corail => "corail",
            NoteColor::Orange => "orange",
            NoteColor::Citron => "citron",
            NoteColor::Pomme => "pomme",
            NoteColor::Turquoise => "turquoise",
            NoteColor::Bleu => "bleu",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        COLOR_ORDER
            .iter()
            .copied()
            .find(|color| color.as_str() == text)
    }
}

/// Autodestruction mode ("la mèche", docs/06). Only `Delay` is used for now: the note goes to
/// the trash a delay after its fuse is lit. `OnComplete` (when every box is checked) is kept
/// because the database schema allows it, but nothing creates it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EphemeralMode {
    Delay,
    OnComplete,
}

impl EphemeralMode {
    fn as_str(self) -> &'static str {
        match self {
            EphemeralMode::Delay => "delay",
            EphemeralMode::OnComplete => "on_complete",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "delay" => Some(EphemeralMode::Delay),
            "on_complete" => Some(EphemeralMode::OnComplete),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrashReason {
    Manual,
    SelfDestruct,
}

impl TrashReason {
    fn as_str(self) -> &'static str {
        match self {
            TrashReason::Manual => "manual",
            TrashReason::SelfDestruct => "self_destruct",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "manual" => Some(TrashReason::Manual),
            "self_destruct" => Some(TrashReason::SelfDestruct),
            _ => None,
        }
    }
}

/// Reads a text column into one of the enums above, using its `parse` function.
/// A value outside the list (impossible thanks to the CHECK constraints) is a conversion error.
fn enum_from_sql<T>(value: ValueRef<'_>, parse: fn(&str) -> Option<T>) -> FromSqlResult<T> {
    parse(value.as_str()?).ok_or(FromSqlError::InvalidType)
}

impl ToSql for NoteKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}
impl FromSql for NoteKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        enum_from_sql(value, NoteKind::parse)
    }
}
impl ToSql for NoteColor {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}
impl FromSql for NoteColor {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        enum_from_sql(value, NoteColor::parse)
    }
}
impl ToSql for EphemeralMode {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}
impl FromSql for EphemeralMode {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        enum_from_sql(value, EphemeralMode::parse)
    }
}
impl ToSql for TrashReason {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}
impl FromSql for TrashReason {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        enum_from_sql(value, TrashReason::parse)
    }
}

// ── Types sent to and received from the frontend ───────────────────────────────────────────

/// A complete note, as returned by `get_note`. Sync columns (server_rev, dirty, deleted) stay
/// in Rust: the frontend never needs them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub kind: NoteKind,
    pub code_language: Option<String>,
    pub pinned: bool,
    pub color: NoteColor,
    pub ephemeral_mode: Option<EphemeralMode>,
    pub ephemeral_delay_hours: Option<i64>,
    pub ephemeral_started_at: Option<i64>,
    pub destroy_at: Option<i64>,
    pub trashed_at: Option<i64>,
    pub trash_reason: Option<TrashReason>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One line of the note list: never the whole content (docs/08).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    /// The title, or the first line of the content when the title is empty.
    pub title: String,
    /// The beginning of the content (after the line used as title), as plain text.
    pub preview: String,
    pub kind: NoteKind,
    pub code_language: Option<String>,
    pub pinned: bool,
    pub color: NoteColor,
    pub ephemeral_mode: Option<EphemeralMode>,
    pub destroy_at: Option<i64>,
    pub trashed_at: Option<i64>,
    pub updated_at: i64,
}

/// Which notes `list_notes` returns (docs/02).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListFilter {
    All,
    Pinned,
    Ephemeral,
    Trash,
}

/// Partial update sent by `update_note`: only the fields present are changed.
/// Changing `kind` converts the content (docs/05, "Conversion entre types").
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotePatch {
    pub title: Option<String>,
    pub content: Option<String>,
    pub kind: Option<NoteKind>,
    pub code_language: Option<String>,
    pub pinned: Option<bool>,
    pub color: Option<NoteColor>,
}

// ── Pure helpers (no database: easy to test) ────────────────────────────────────────────────

/// A mixed order of the 8 colors: new notes follow it (docs/11, "Attribution").
const COLOR_ORDER: [NoteColor; 8] = [
    NoteColor::Violet,
    NoteColor::Turquoise,
    NoteColor::Orange,
    NoteColor::Bleu,
    NoteColor::Rose,
    NoteColor::Pomme,
    NoteColor::Corail,
    NoteColor::Citron,
];

/// Color of a new note: the next one in `COLOR_ORDER` after the latest note's color, skipping
/// the colors of the 2 latest notes (`recent`, newest first).
pub fn next_color(recent: &[NoteColor]) -> NoteColor {
    let Some(latest) = recent.first() else {
        return COLOR_ORDER[0];
    };
    let start = COLOR_ORDER
        .iter()
        .position(|color| color == latest)
        .unwrap_or(0);
    (1..=COLOR_ORDER.len())
        .map(|offset| COLOR_ORDER[(start + offset) % COLOR_ORDER.len()])
        .find(|color| !recent.contains(color))
        .unwrap_or(COLOR_ORDER[0])
}

/// Title and preview shown in the list for a note whose content starts with `content_start`.
pub fn list_texts(title: &str, content_start: &str, kind: NoteKind) -> (String, String) {
    let mut lines = content_start
        .lines()
        .filter_map(|line| match kind {
            NoteKind::Rich => markdown_line_to_text(line, Entities::Encoded),
            NoteKind::Code => Some(line.trim().to_string()),
        })
        .filter(|line| !line.is_empty());

    let title = title.trim();
    let shown_title = if title.is_empty() {
        lines.next().unwrap_or_default()
    } else {
        title.to_string()
    };
    let preview = lines.collect::<Vec<_>>().join(" ");
    (
        truncate_chars(&shown_title, PREVIEW_MAX_CHARS),
        truncate_chars(&preview, PREVIEW_MAX_CHARS),
    )
}

/// Cuts `text` to at most `max` characters (not bytes: "é" is one character but two bytes),
/// adding "…" when something was removed.
fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let kept: String = text.chars().take(max - 1).collect();
    format!("{}…", kept.trim_end())
}

/// Whether a text still holds the HTML entities the editor writes (`&amp;`, `&lt;`…).
/// Notes do; search excerpts do not, since the search index reads the notes decoded
/// (migration 002).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Entities {
    Encoded,
    Decoded,
}

/// Plain text of one Markdown line, or `None` for lines that carry no text (code fences,
/// separators, table borders, empty paragraphs). `pub(crate)`: visible to the rest of this
/// crate (the search module), but not part of any public API.
pub(crate) fn markdown_line_to_text(line: &str, entities: Entities) -> Option<String> {
    let trimmed = line.trim();
    let only_symbols = !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| matches!(c, '-' | '*' | '_' | '=' | '|' | ':' | ' ' | '`' | '~'));
    if trimmed.is_empty() || only_symbols || trimmed == "&nbsp;" {
        return None;
    }

    // Block prefixes: quotes, list markers, task boxes, heading hashes.
    let mut rest = trimmed;
    loop {
        let before = rest;
        rest = rest.trim_start();
        for prefix in ["> ", ">", "- ", "* ", "+ ", "[ ] ", "[x] ", "[X] "] {
            if let Some(stripped) = rest.strip_prefix(prefix) {
                rest = stripped;
            }
        }
        // An empty task item ("- [ ] " once trimmed) is only its box.
        if matches!(rest, "[ ]" | "[x]" | "[X]") {
            rest = "";
        }
        let hashes = rest.chars().take_while(|&c| c == '#').count();
        if (1..=6).contains(&hashes) && rest[hashes..].starts_with(' ') {
            rest = &rest[hashes + 1..];
        }
        let digits = rest.chars().take_while(char::is_ascii_digit).count();
        if digits > 0 && (rest[digits..].starts_with(". ") || rest[digits..].starts_with(") ")) {
            rest = &rest[digits + 2..];
        }
        if rest == before {
            break;
        }
    }
    // Code fences such as "```php", and a "\" alone: the editor's second line break in a row.
    if rest.starts_with("```") || rest.starts_with("~~~") || rest == "\\" {
        return None;
    }

    let text = inline_markdown_to_text(&rest.replace('|', " "), entities);
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(text)
}

/// Removes inline Markdown: emphasis markers, code ticks, link targets, escapes and, when
/// still there, the HTML entities written by the editor.
fn inline_markdown_to_text(text: &str, entities: Entities) -> String {
    let text = match entities {
        // "&amp;" last: "&amp;lt;" is the text "&lt;", not "<".
        Entities::Encoded => text
            .replace("&nbsp;", " ")
            .replace("&#32;", " ")
            .replace("&#9;", "\t")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&"),
        Entities::Decoded => text.to_string(),
    };
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            // "\*" → "*": an escaped character is kept as is.
            '\\' if i + 1 < chars.len() && chars[i + 1].is_ascii_punctuation() => {
                out.push(chars[i + 1]);
                i += 2;
            }
            '*' | '~' | '`' => i += 1,
            // "[text](url)" → "text": skip the "(url)" part after "]".
            ']' if chars.get(i + 1) == Some(&'(') => {
                match chars[i..].iter().position(|&ch| ch == ')') {
                    Some(end) => i += end + 1,
                    None => i += 1,
                }
            }
            // "[" opening a link "[text](url)" is dropped; any other "[" is text ("tab[0]").
            '[' if opens_link(&chars, i) => i += 1,
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

/// True when the "[" at `start` opens a link: its closing "]" is followed by "(".
/// An escaped "\]" in the link text does not close it.
/// `&[char]` is a borrowed slice: the function reads the characters without copying them.
fn opens_link(chars: &[char], start: usize) -> bool {
    let mut i = start + 1;
    while i < chars.len() {
        match chars[i] {
            '\\' => i += 2,
            ']' => return chars.get(i + 1) == Some(&'('),
            _ => i += 1,
        }
    }
    false
}

/// Converts the content of a note to another kind (docs/05, "Conversion entre types"):
/// rich → code keeps the raw Markdown (language "markdown"); code → rich wraps the code in a
/// fenced code block with its language.
pub fn convert_content(
    content: &str,
    from: NoteKind,
    to: NoteKind,
    code_language: Option<&str>,
) -> (String, Option<String>) {
    match (from, to) {
        (NoteKind::Rich, NoteKind::Code) => (content.to_string(), Some("markdown".to_string())),
        (NoteKind::Code, NoteKind::Rich) => {
            // The fence must be longer than any run of backticks inside the code.
            let longest_run = content.split(|c| c != '`').map(str::len).max().unwrap_or(0);
            let fence = "`".repeat(longest_run.max(2) + 1);
            let language = code_language.filter(|language| *language != "plaintext");
            let body = content.strip_suffix('\n').unwrap_or(content);
            let block = format!("{fence}{}\n{body}\n{fence}", language.unwrap_or(""));
            (block, None)
        }
        _ => (content.to_string(), code_language.map(str::to_string)),
    }
}

fn validate(note: &Note) -> Result<()> {
    if note.title.chars().count() > MAX_TITLE_CHARS {
        return Err(Error::InvalidInput(format!(
            "the title is longer than {MAX_TITLE_CHARS} characters"
        )));
    }
    if note.content.len() > MAX_CONTENT_BYTES {
        return Err(Error::InvalidInput(
            "the note is larger than 2 MB".to_string(),
        ));
    }
    Ok(())
}

// ── Queries ──────────────────────────────────────────────────────────────────────────────────

const NOTE_COLUMNS: &str = "id, title, content, kind, code_language, pinned, color, \
     ephemeral_mode, ephemeral_delay_hours, ephemeral_started_at, destroy_at, \
     trashed_at, trash_reason, created_at, updated_at";

/// Builds a `Note` from a row selected with `NOTE_COLUMNS`. `row.get(n)` converts column `n`
/// to the type of the field, using the `FromSql` implementations above.
fn note_from_row(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
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
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

/// Colors of the 2 most recently created notes, newest first.
fn recent_colors(conn: &Connection) -> Result<Vec<NoteColor>> {
    let mut stmt = conn.prepare(
        "SELECT color FROM notes WHERE deleted = 0 ORDER BY created_at DESC, id DESC LIMIT 2",
    )?;
    let colors = stmt
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<NoteColor>>>()?;
    Ok(colors)
}

/// Creates an empty note of the given kind, with an automatic color.
pub fn create(conn: &Connection, kind: NoteKind, now: i64) -> Result<Note> {
    insert(conn, kind, None, now)
}

/// Creates an empty note whose fuse is already lit for `delay_hours` hours
/// (« Nouvelle note à mèche »).
pub fn create_fused(conn: &Connection, kind: NoteKind, delay_hours: i64, now: i64) -> Result<Note> {
    insert(conn, kind, Some(delay_hours), now)
}

/// Inserts a new empty note, with its fuse lit when `fuse_delay_hours` is `Some`.
fn insert(
    conn: &Connection,
    kind: NoteKind,
    fuse_delay_hours: Option<i64>,
    now: i64,
) -> Result<Note> {
    // UUID v7: unique without asking a server, and sortable by creation date (docs/02, D7).
    let id = uuid::Uuid::now_v7().to_string();
    let color = next_color(&recent_colors(conn)?);
    let code_language = match kind {
        NoteKind::Code => Some("plaintext".to_string()),
        NoteKind::Rich => None,
    };
    let fuse = Fuse::lit(fuse_delay_hours, now);
    conn.execute(
        "INSERT INTO notes (id, kind, code_language, color, ephemeral_mode, ephemeral_delay_hours,
                            ephemeral_started_at, destroy_at, created_at, updated_at, dirty)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 1)",
        params![
            id,
            kind,
            code_language,
            color,
            fuse.mode,
            fuse.delay_hours,
            fuse.started_at,
            fuse.destroy_at,
            now
        ],
    )?;
    get(conn, &id)
}

/// The four fuse columns of a note, all set or all empty.
struct Fuse {
    mode: Option<EphemeralMode>,
    delay_hours: Option<i64>,
    started_at: Option<i64>,
    destroy_at: Option<i64>,
}

impl Fuse {
    /// A fuse lit at `now` for `delay_hours` hours, or no fuse at all when `None`.
    fn lit(delay_hours: Option<i64>, now: i64) -> Fuse {
        Fuse {
            mode: delay_hours.map(|_| EphemeralMode::Delay),
            delay_hours,
            started_at: delay_hours.map(|_| now),
            destroy_at: delay_hours.map(|hours| ephemeral::destroy_at(now, hours)),
        }
    }
}

/// Lights (`enabled`) or puts out the fuse of note `id` and returns the note (docs/06).
///
/// A fuse is lit for `delay_hours` hours from `now` and keeps that delay: changing the setting
/// later does not change it. Lighting a fuse that is already lit, or putting out one that is
/// already out, changes nothing. A note in the trash is read-only: refused.
pub fn set_ephemeral(
    conn: &Connection,
    id: &str,
    enabled: bool,
    delay_hours: i64,
    now: i64,
) -> Result<Note> {
    let note = get(conn, id)?;
    if note.trashed_at.is_some() {
        return Err(Error::InvalidInput(
            "the fuse of a note in the trash cannot be changed".to_string(),
        ));
    }
    if enabled == note.ephemeral_mode.is_some() {
        return Ok(note);
    }
    let fuse = Fuse::lit(enabled.then_some(delay_hours), now);
    conn.execute(
        "UPDATE notes SET ephemeral_mode = ?2, ephemeral_delay_hours = ?3,
                ephemeral_started_at = ?4, destroy_at = ?5, updated_at = ?6, dirty = 1
         WHERE id = ?1",
        params![
            id,
            fuse.mode,
            fuse.delay_hours,
            fuse.started_at,
            fuse.destroy_at,
            now
        ],
    )?;
    get(conn, id)
}

/// The complete note `id`. Deleted notes (tombstones) are not found.
pub fn get(conn: &Connection, id: &str) -> Result<Note> {
    conn.query_row(
        &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1 AND deleted = 0"),
        [id],
        note_from_row,
    )
    .optional()?
    .ok_or_else(|| Error::NotFound(id.to_string()))
}

/// Summaries of the notes selected by `filter`: pinned first, then most recently modified.
/// The trash is sorted by deletion date, the lit fuses by the moment they burn out.
pub fn list(conn: &Connection, filter: ListFilter) -> Result<Vec<NoteSummary>> {
    let condition = match filter {
        ListFilter::All => "trashed_at IS NULL",
        ListFilter::Pinned => "trashed_at IS NULL AND pinned = 1",
        ListFilter::Ephemeral => "trashed_at IS NULL AND ephemeral_mode IS NOT NULL",
        ListFilter::Trash => "trashed_at IS NOT NULL",
    };
    let order = match filter {
        ListFilter::Trash => "trashed_at DESC",
        // Soonest first. `destroy_at IS NULL` (0 or 1) puts a fuse without date last.
        ListFilter::Ephemeral => "destroy_at IS NULL, destroy_at ASC, updated_at DESC",
        _ => "pinned DESC, updated_at DESC",
    };
    let sql = format!(
        "SELECT id, title, substr(content, 1, {PREVIEW_SOURCE_CHARS}), kind, code_language,
                pinned, color, ephemeral_mode, destroy_at, trashed_at, updated_at
         FROM notes WHERE deleted = 0 AND {condition} ORDER BY {order}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let summaries = stmt
        .query_map([], |row| {
            let kind: NoteKind = row.get(3)?;
            let stored_title: String = row.get(1)?;
            let content_start: String = row.get(2)?;
            let (title, preview) = list_texts(&stored_title, &content_start, kind);
            Ok(NoteSummary {
                id: row.get(0)?,
                title,
                preview,
                kind,
                code_language: row.get(4)?,
                pinned: row.get(5)?,
                color: row.get(6)?,
                ephemeral_mode: row.get(7)?,
                destroy_at: row.get(8)?,
                trashed_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(summaries)
}

/// Applies `patch` to note `id` and returns the updated note. Nothing is written (and the
/// note is not marked as modified) when the patch changes nothing.
///
/// A note in the trash is accepted on purpose, although the interface shows it read-only: when
/// the open note explodes while you type, the last save arrives after the explosion and must
/// not be lost (docs/06). The fuse and trash columns are never touched here, so the explosion
/// stays as it was (trashed_at = destroy_at).
pub fn update(conn: &Connection, id: &str, patch: NotePatch, now: i64) -> Result<Note> {
    let current = get(conn, id)?;
    // `clone()` makes an independent copy, so `current` stays untouched for the comparison.
    let mut note = current.clone();

    // `if let … && …` (a "let chain"): both conditions must hold.
    if let Some(kind) = patch.kind
        && kind != note.kind
    {
        let (content, code_language) = convert_content(
            &note.content,
            note.kind,
            kind,
            note.code_language.as_deref(),
        );
        note.content = content;
        note.code_language = code_language;
        note.kind = kind;
    }
    if let Some(title) = patch.title {
        note.title = title;
    }
    if let Some(content) = patch.content {
        note.content = content;
    }
    if let Some(code_language) = patch.code_language {
        note.code_language = Some(code_language);
    }
    if let Some(pinned) = patch.pinned {
        note.pinned = pinned;
    }
    if let Some(color) = patch.color {
        note.color = color;
    }

    if note == current {
        return Ok(current);
    }
    validate(&note)?;
    note.updated_at = now;
    conn.execute(
        "UPDATE notes SET title = ?2, content = ?3, kind = ?4, code_language = ?5, pinned = ?6,
                color = ?7, updated_at = ?8, dirty = 1
         WHERE id = ?1",
        params![
            note.id,
            note.title,
            note.content,
            note.kind,
            note.code_language,
            note.pinned,
            note.color,
            note.updated_at
        ],
    )?;
    Ok(note)
}

/// Moves a note to the trash (recoverable, docs/06).
pub fn trash(conn: &Connection, id: &str, now: i64) -> Result<()> {
    let changed = conn.execute(
        "UPDATE notes SET trashed_at = ?2, trash_reason = ?3, updated_at = ?2, dirty = 1
         WHERE id = ?1 AND deleted = 0 AND trashed_at IS NULL",
        params![id, now, TrashReason::Manual],
    )?;
    ensure_found(changed, id, conn)
}

/// Takes a note out of the trash. Its fuse is put out when the note destroyed itself, or when
/// the fuse has burnt out while the note was in the trash: otherwise it would go straight back
/// to the trash (docs/06).
pub fn restore(conn: &Connection, id: &str, now: i64) -> Result<()> {
    // `?2` is now. In an UPDATE, every expression reads the row as it was before the update:
    // `trash_reason` and `destroy_at` are the old values on every line.
    const FUSE_OUT: &str = "(trash_reason = 'self_destruct' OR destroy_at <= ?2)";
    let changed = conn.execute(
        &format!(
            "UPDATE notes SET
               ephemeral_mode = CASE WHEN {FUSE_OUT} THEN NULL ELSE ephemeral_mode END,
               ephemeral_delay_hours = CASE WHEN {FUSE_OUT} THEN NULL ELSE ephemeral_delay_hours END,
               ephemeral_started_at = CASE WHEN {FUSE_OUT} THEN NULL ELSE ephemeral_started_at END,
               destroy_at = CASE WHEN {FUSE_OUT} THEN NULL ELSE destroy_at END,
               trashed_at = NULL, trash_reason = NULL, updated_at = ?2, dirty = 1
             WHERE id = ?1 AND deleted = 0 AND trashed_at IS NOT NULL"
        ),
        params![id, now],
    )?;
    ensure_found(changed, id, conn)
}

/// Deletes a note of the trash for good. A note the server has never seen is simply removed;
/// otherwise it becomes a tombstone (no title, no content) so that the deletion reaches the
/// other devices at the next sync (docs/04).
pub fn delete_forever(conn: &Connection, id: &str, now: i64) -> Result<()> {
    let note = get(conn, id)?;
    if note.trashed_at.is_none() {
        return Err(Error::InvalidInput(
            "only notes in the trash can be deleted forever".to_string(),
        ));
    }
    remove_or_tombstone(conn, id, now)
}

/// Deletes every note of the trash for good, in one transaction. Returns how many.
pub fn empty_trash(conn: &mut Connection, now: i64) -> Result<usize> {
    let tx = conn.transaction()?;
    let ids = {
        let mut stmt =
            tx.prepare("SELECT id FROM notes WHERE deleted = 0 AND trashed_at IS NOT NULL")?;
        stmt.query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?
    }; // `stmt` borrows `tx`: this block ends the borrow before `tx.commit()` below.
    for id in &ids {
        remove_or_tombstone(&tx, id, now)?;
    }
    tx.commit()?;
    Ok(ids.len())
}

/// Removes a note that the server has never seen, or turns it into a tombstone (docs/04).
/// `pub(crate)`: also used by the trash purge (`ephemeral`).
pub(crate) fn remove_or_tombstone(conn: &Connection, id: &str, now: i64) -> Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1 AND server_rev = 0", [id])?;
    conn.execute(
        "UPDATE notes SET deleted = 1, title = '', content = '', updated_at = ?2, dirty = 1
         WHERE id = ?1",
        params![id, now],
    )?;
    conn.execute("DELETE FROM import_triage WHERE note_id = ?1", [id])?;
    Ok(())
}

/// Turns "0 rows changed" into the right error: the note does not exist, or it was not in the
/// expected state (e.g. restoring a note that is not in the trash).
fn ensure_found(changed: usize, id: &str, conn: &Connection) -> Result<()> {
    if changed > 0 {
        return Ok(());
    }
    get(conn, id)?; // NotFound if the note does not exist at all.
    Err(Error::InvalidInput(format!(
        "note {id} is not in a state that allows this action"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn rich_note(conn: &Connection, title: &str, content: &str, now: i64) -> Note {
        let note = create(conn, NoteKind::Rich, now).unwrap();
        let patch = NotePatch {
            title: Some(title.to_string()),
            content: Some(content.to_string()),
            ..NotePatch::default()
        };
        update(conn, &note.id, patch, now).unwrap()
    }

    fn ids(summaries: &[NoteSummary]) -> Vec<&str> {
        summaries
            .iter()
            .map(|summary| summary.id.as_str())
            .collect()
    }

    // ── colors

    #[test]
    fn first_note_gets_the_first_color() {
        assert_eq!(next_color(&[]), NoteColor::Violet);
    }

    #[test]
    fn next_color_follows_the_mixed_order() {
        assert_eq!(next_color(&[NoteColor::Violet]), NoteColor::Turquoise);
        assert_eq!(next_color(&[NoteColor::Citron]), NoteColor::Violet);
    }

    #[test]
    fn next_color_avoids_the_two_latest_colors() {
        // After violet comes turquoise, but the note before the latest one is turquoise.
        assert_eq!(
            next_color(&[NoteColor::Violet, NoteColor::Turquoise]),
            NoteColor::Orange
        );
    }

    #[test]
    fn consecutive_notes_never_share_a_color() {
        let conn = open_in_memory().unwrap();
        let colors: Vec<NoteColor> = (0..20)
            .map(|i| create(&conn, NoteKind::Rich, i).unwrap().color)
            .collect();
        for window in colors.windows(3) {
            assert_ne!(window[2], window[1]);
            assert_ne!(window[2], window[0]);
        }
    }

    // ── create / get

    #[test]
    fn creates_notes_of_both_kinds() {
        let conn = open_in_memory().unwrap();
        let rich = create(&conn, NoteKind::Rich, 1_000).unwrap();
        assert_eq!(rich.kind, NoteKind::Rich);
        assert_eq!(rich.code_language, None);
        assert_eq!(rich.created_at, 1_000);
        assert_eq!(rich.updated_at, 1_000);
        assert_eq!(rich.title, "");
        assert!(uuid::Uuid::parse_str(&rich.id).is_ok());

        let code = create(&conn, NoteKind::Code, 2_000).unwrap();
        assert_eq!(code.kind, NoteKind::Code);
        assert_eq!(code.code_language.as_deref(), Some("plaintext"));
        assert_eq!(get(&conn, &code.id).unwrap(), code);
    }

    #[test]
    fn new_notes_are_dirty() {
        let conn = open_in_memory().unwrap();
        let note = create(&conn, NoteKind::Rich, 0).unwrap();
        let dirty: i64 = conn
            .query_row("SELECT dirty FROM notes WHERE id = ?1", [&note.id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(dirty, 1);
    }

    #[test]
    fn unknown_note_is_not_found() {
        let conn = open_in_memory().unwrap();
        assert!(matches!(get(&conn, "nope"), Err(Error::NotFound(_))));
    }

    // ── update

    #[test]
    fn update_changes_only_the_given_fields() {
        let conn = open_in_memory().unwrap();
        let note = rich_note(&conn, "Courses", "- [ ] Lait", 1_000);
        let patch = NotePatch {
            pinned: Some(true),
            color: Some(NoteColor::Citron),
            ..NotePatch::default()
        };
        let updated = update(&conn, &note.id, patch, 2_000).unwrap();
        assert!(updated.pinned);
        assert_eq!(updated.color, NoteColor::Citron);
        assert_eq!(updated.title, "Courses");
        assert_eq!(updated.content, "- [ ] Lait");
        assert_eq!(updated.updated_at, 2_000);
        assert_eq!(get(&conn, &note.id).unwrap(), updated);
    }

    #[test]
    fn update_without_change_does_not_touch_the_note() {
        let conn = open_in_memory().unwrap();
        let note = rich_note(&conn, "Courses", "Lait", 1_000);
        let same = NotePatch {
            content: Some("Lait".to_string()),
            ..NotePatch::default()
        };
        let result = update(&conn, &note.id, same, 9_000).unwrap();
        assert_eq!(result.updated_at, 1_000);
    }

    #[test]
    fn update_rejects_a_too_long_title_or_content() {
        let conn = open_in_memory().unwrap();
        let note = create(&conn, NoteKind::Rich, 0).unwrap();
        let long_title = NotePatch {
            title: Some("é".repeat(MAX_TITLE_CHARS + 1)),
            ..NotePatch::default()
        };
        assert!(matches!(
            update(&conn, &note.id, long_title, 1),
            Err(Error::InvalidInput(_))
        ));
        let ok_title = NotePatch {
            title: Some("é".repeat(MAX_TITLE_CHARS)),
            ..NotePatch::default()
        };
        assert!(update(&conn, &note.id, ok_title, 1).is_ok());
        let huge = NotePatch {
            content: Some("x".repeat(MAX_CONTENT_BYTES + 1)),
            ..NotePatch::default()
        };
        assert!(matches!(
            update(&conn, &note.id, huge, 1),
            Err(Error::InvalidInput(_))
        ));
    }

    #[test]
    fn converting_rich_to_code_keeps_the_markdown() {
        let conn = open_in_memory().unwrap();
        let note = rich_note(&conn, "", "# Titre\n\n- [ ] Lait", 0);
        let patch = NotePatch {
            kind: Some(NoteKind::Code),
            ..NotePatch::default()
        };
        let code = update(&conn, &note.id, patch, 1).unwrap();
        assert_eq!(code.kind, NoteKind::Code);
        assert_eq!(code.content, "# Titre\n\n- [ ] Lait");
        assert_eq!(code.code_language.as_deref(), Some("markdown"));
    }

    #[test]
    fn converting_code_to_rich_wraps_the_code_in_a_block() {
        assert_eq!(
            convert_content("echo 1\n", NoteKind::Code, NoteKind::Rich, Some("bash")),
            ("```bash\necho 1\n```".to_string(), None)
        );
        assert_eq!(
            convert_content("texte", NoteKind::Code, NoteKind::Rich, Some("plaintext")),
            ("```\ntexte\n```".to_string(), None)
        );
        // A longer fence when the code itself contains ```.
        assert_eq!(
            convert_content("a ``` b", NoteKind::Code, NoteKind::Rich, Some("markdown")).0,
            "````markdown\na ``` b\n````"
        );
    }

    #[test]
    fn patch_from_the_frontend_uses_camel_case_and_rejects_typos() {
        let patch: NotePatch =
            serde_json::from_str(r#"{ "codeLanguage": "rust", "pinned": true }"#).unwrap();
        assert_eq!(patch.code_language.as_deref(), Some("rust"));
        assert_eq!(patch.pinned, Some(true));
        assert!(serde_json::from_str::<NotePatch>(r#"{ "pined": true }"#).is_err());
    }

    // ── list

    #[test]
    fn list_puts_pinned_notes_first_then_the_latest() {
        let conn = open_in_memory().unwrap();
        let old = rich_note(&conn, "Ancienne", "", 1_000);
        let pinned = rich_note(&conn, "Épinglée", "", 2_000);
        let recent = rich_note(&conn, "Récente", "", 3_000);
        let patch = NotePatch {
            pinned: Some(true),
            ..NotePatch::default()
        };
        update(&conn, &pinned.id, patch, 2_000).unwrap();

        let all = list(&conn, ListFilter::All).unwrap();
        assert_eq!(ids(&all), [&pinned.id, &recent.id, &old.id]);
        let only_pinned = list(&conn, ListFilter::Pinned).unwrap();
        assert_eq!(ids(&only_pinned), [&pinned.id]);
    }

    #[test]
    fn list_filters_ephemeral_notes() {
        let conn = open_in_memory().unwrap();
        let fused = create(&conn, NoteKind::Rich, 0).unwrap();
        create(&conn, NoteKind::Rich, 0).unwrap();
        conn.execute(
            "UPDATE notes SET ephemeral_mode = 'delay' WHERE id = ?1",
            [&fused.id],
        )
        .unwrap();
        let ephemeral = list(&conn, ListFilter::Ephemeral).unwrap();
        assert_eq!(ids(&ephemeral), [&fused.id]);
        assert_eq!(ephemeral[0].ephemeral_mode, Some(EphemeralMode::Delay));
    }

    #[test]
    fn list_shows_the_first_line_when_the_title_is_empty() {
        let conn = open_in_memory().unwrap();
        rich_note(
            &conn,
            "",
            "# Courses du samedi\n\n- [ ] Lait\n- [x] Pain",
            0,
        );
        let summary = &list(&conn, ListFilter::All).unwrap()[0];
        assert_eq!(summary.title, "Courses du samedi");
        assert_eq!(summary.preview, "Lait Pain");
    }

    #[test]
    fn list_never_loads_whole_notes() {
        let conn = open_in_memory().unwrap();
        rich_note(&conn, "Long", &"mot ".repeat(10_000), 0);
        let summary = &list(&conn, ListFilter::All).unwrap()[0];
        assert!(summary.preview.chars().count() <= PREVIEW_MAX_CHARS);
        assert!(summary.preview.ends_with('…'));
    }

    // ── list texts

    #[test]
    fn list_texts_strip_markdown() {
        let content = "## Mémo **serveur**\n\n> Penser à `certbot` et [Apache](https://httpd.apache.org)\n\n```bash\nsudo certbot\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
        let (title, preview) = list_texts("", content, NoteKind::Rich);
        assert_eq!(title, "Mémo serveur");
        assert_eq!(preview, "Penser à certbot et Apache sudo certbot a b 1 2");
    }

    #[test]
    fn list_texts_decode_the_entities_of_the_editor() {
        let (title, preview) = list_texts(
            "",
            "&#32;  indenté\n&amp;lt; reste &amp;lt;",
            NoteKind::Rich,
        );
        assert_eq!(title, "indenté");
        assert_eq!(preview, "&lt; reste &lt;");
    }

    #[test]
    fn list_texts_skip_the_backslash_of_a_second_line_break() {
        let (title, preview) = list_texts("", "Courses :  \n\\\nlait", NoteKind::Rich);
        assert_eq!(title, "Courses :");
        assert_eq!(preview, "lait");
    }

    #[test]
    fn list_texts_read_links_whose_text_has_brackets() {
        let (title, preview) = list_texts(
            "",
            "[a\\]b](https://x.y)\n[\\[a\\]](https://x.y)",
            NoteKind::Rich,
        );
        assert_eq!(title, "a]b");
        assert_eq!(preview, "[a]");
    }

    #[test]
    fn list_texts_skip_empty_task_items_and_keep_plain_brackets() {
        let content = "- [ ] \n- [ ] Lait\n- [x] \ntab[0] et [lien](https://x.y)";
        let (title, preview) = list_texts("", content, NoteKind::Rich);
        assert_eq!(title, "Lait");
        assert_eq!(preview, "tab[0] et lien");
    }

    #[test]
    fn list_texts_keep_escaped_characters_and_entities() {
        let (title, _) = list_texts("", "1\\. pas une liste &lt;div&gt; a\\_b", NoteKind::Rich);
        assert_eq!(title, "1. pas une liste <div> a_b");
    }

    #[test]
    fn list_texts_of_code_notes_are_raw_lines() {
        let (title, preview) = list_texts("", "\n  <?php\n\necho 'hi';\n", NoteKind::Code);
        assert_eq!(title, "<?php");
        assert_eq!(preview, "echo 'hi';");
    }

    #[test]
    fn list_texts_use_the_title_when_there_is_one() {
        let (title, preview) = list_texts("  Courses  ", "- [ ] Lait", NoteKind::Rich);
        assert_eq!(title, "Courses");
        assert_eq!(preview, "Lait");
    }

    // ── trash

    #[test]
    fn trash_and_restore() {
        let conn = open_in_memory().unwrap();
        let note = rich_note(&conn, "Courses", "", 0);
        trash(&conn, &note.id, 5_000).unwrap();

        assert!(list(&conn, ListFilter::All).unwrap().is_empty());
        let in_trash = list(&conn, ListFilter::Trash).unwrap();
        assert_eq!(ids(&in_trash), [&note.id]);
        assert_eq!(in_trash[0].trashed_at, Some(5_000));
        let trashed = get(&conn, &note.id).unwrap();
        assert_eq!(trashed.trash_reason, Some(TrashReason::Manual));

        restore(&conn, &note.id, 6_000).unwrap();
        let restored = get(&conn, &note.id).unwrap();
        assert_eq!(restored.trashed_at, None);
        assert_eq!(restored.trash_reason, None);
        assert_eq!(restored.updated_at, 6_000);
    }

    #[test]
    fn restoring_a_self_destructed_note_turns_its_fuse_off() {
        let conn = open_in_memory().unwrap();
        let note = create(&conn, NoteKind::Rich, 0).unwrap();
        conn.execute(
            "UPDATE notes SET ephemeral_mode = 'delay', ephemeral_delay_hours = 1,
                    ephemeral_started_at = 0, destroy_at = 3600000, trashed_at = 3600000,
                    trash_reason = 'self_destruct'
             WHERE id = ?1",
            [&note.id],
        )
        .unwrap();
        restore(&conn, &note.id, 4_000_000).unwrap();
        let restored = get(&conn, &note.id).unwrap();
        assert_eq!(restored.ephemeral_mode, None);
        assert_eq!(restored.ephemeral_delay_hours, None);
        assert_eq!(restored.ephemeral_started_at, None);
        assert_eq!(restored.destroy_at, None);
        assert_eq!(restored.trashed_at, None);
        assert_eq!(restored.trash_reason, None);
    }

    // ── fuse (docs/06)

    const HOUR: i64 = 3_600_000;

    #[test]
    fn lighting_a_fuse_starts_the_countdown_now() {
        let conn = open_in_memory().unwrap();
        let note = create(&conn, NoteKind::Rich, 0).unwrap();
        let lit = set_ephemeral(&conn, &note.id, true, 24, 5_000).unwrap();
        assert_eq!(lit.ephemeral_mode, Some(EphemeralMode::Delay));
        assert_eq!(lit.ephemeral_delay_hours, Some(24));
        assert_eq!(lit.ephemeral_started_at, Some(5_000));
        assert_eq!(lit.destroy_at, Some(5_000 + 24 * HOUR));
        assert_eq!(lit.updated_at, 5_000);
        assert_eq!(get(&conn, &note.id).unwrap(), lit);
    }

    #[test]
    fn lighting_a_lit_fuse_keeps_its_delay_and_its_start() {
        // The setting changed from 24 h to 7 days: the fuse already burning is not touched.
        let conn = open_in_memory().unwrap();
        let note = create(&conn, NoteKind::Code, 0).unwrap();
        let lit = set_ephemeral(&conn, &note.id, true, 24, 1_000).unwrap();
        let again = set_ephemeral(&conn, &note.id, true, 168, 9_000).unwrap();
        assert_eq!(again, lit);
    }

    #[test]
    fn putting_a_fuse_out_clears_it() {
        let conn = open_in_memory().unwrap();
        let note = create(&conn, NoteKind::Rich, 0).unwrap();
        set_ephemeral(&conn, &note.id, true, 1, 1_000).unwrap();
        let out = set_ephemeral(&conn, &note.id, false, 1, 2_000).unwrap();
        assert_eq!(
            (
                out.ephemeral_mode,
                out.ephemeral_delay_hours,
                out.ephemeral_started_at,
                out.destroy_at
            ),
            (None, None, None, None)
        );
        assert_eq!(out.updated_at, 2_000);
        // Already out: nothing is written.
        assert_eq!(
            set_ephemeral(&conn, &note.id, false, 1, 3_000).unwrap(),
            out
        );
    }

    #[test]
    fn the_fuse_of_a_note_in_the_trash_cannot_change() {
        let conn = open_in_memory().unwrap();
        let note = create(&conn, NoteKind::Rich, 0).unwrap();
        trash(&conn, &note.id, 1).unwrap();
        assert!(matches!(
            set_ephemeral(&conn, &note.id, true, 1, 2),
            Err(Error::InvalidInput(_))
        ));
        assert!(matches!(
            set_ephemeral(&conn, "nope", true, 1, 2),
            Err(Error::NotFound(_))
        ));
    }

    #[test]
    fn creates_a_note_whose_fuse_is_already_lit() {
        let conn = open_in_memory().unwrap();
        let note = create_fused(&conn, NoteKind::Rich, 72, 1_000).unwrap();
        assert_eq!(note.ephemeral_mode, Some(EphemeralMode::Delay));
        assert_eq!(note.ephemeral_delay_hours, Some(72));
        assert_eq!(note.ephemeral_started_at, Some(1_000));
        assert_eq!(note.destroy_at, Some(1_000 + 72 * HOUR));
        assert_eq!((note.created_at, note.updated_at), (1_000, 1_000));
        assert_eq!(note.content, "");
        // A plain new note has no fuse.
        let plain = create(&conn, NoteKind::Rich, 1_000).unwrap();
        assert_eq!((plain.ephemeral_mode, plain.destroy_at), (None, None));
    }

    #[test]
    fn editing_or_converting_a_note_keeps_its_fuse_burning() {
        let conn = open_in_memory().unwrap();
        let note = create_fused(&conn, NoteKind::Rich, 24, 0).unwrap();
        let patch = NotePatch {
            content: Some("Lait".to_string()),
            kind: Some(NoteKind::Code),
            ..NotePatch::default()
        };
        let edited = update(&conn, &note.id, patch, 5_000).unwrap();
        assert_eq!(edited.ephemeral_started_at, Some(0));
        assert_eq!(edited.destroy_at, Some(24 * HOUR));
    }

    #[test]
    fn what_was_typed_when_the_note_exploded_is_still_saved() {
        let mut conn = open_in_memory().unwrap();
        let note = create_fused(&conn, NoteKind::Rich, 1, 0).unwrap();
        assert!(ephemeral::run_maintenance(&mut conn, HOUR).unwrap());
        let exploded = get(&conn, &note.id).unwrap();

        let late_save = NotePatch {
            content: Some("Lait, pain".to_string()),
            ..NotePatch::default()
        };
        let saved = update(&conn, &note.id, late_save, HOUR + 500).unwrap();
        assert_eq!(saved.content, "Lait, pain");
        // Still exploded, exactly as before.
        assert_eq!(saved.trashed_at, Some(HOUR));
        assert_eq!(saved.trash_reason, Some(TrashReason::SelfDestruct));
        assert_eq!(
            (
                saved.ephemeral_mode,
                saved.ephemeral_started_at,
                saved.destroy_at
            ),
            (
                exploded.ephemeral_mode,
                exploded.ephemeral_started_at,
                exploded.destroy_at
            )
        );
    }

    #[test]
    fn restoring_a_note_trashed_by_hand_keeps_a_fuse_still_burning() {
        let conn = open_in_memory().unwrap();
        let note = create_fused(&conn, NoteKind::Rich, 24, 0).unwrap();
        trash(&conn, &note.id, HOUR).unwrap();
        restore(&conn, &note.id, 2 * HOUR).unwrap();
        let restored = get(&conn, &note.id).unwrap();
        assert_eq!(restored.destroy_at, Some(24 * HOUR));
        assert_eq!(restored.ephemeral_mode, Some(EphemeralMode::Delay));
    }

    #[test]
    fn restoring_a_note_trashed_by_hand_puts_out_a_burnt_fuse() {
        // Its fuse burnt out while it was in the trash: restored, it would explode at once.
        let conn = open_in_memory().unwrap();
        let note = create_fused(&conn, NoteKind::Rich, 1, 0).unwrap();
        trash(&conn, &note.id, 10).unwrap();
        restore(&conn, &note.id, HOUR).unwrap();
        let restored = get(&conn, &note.id).unwrap();
        assert_eq!((restored.ephemeral_mode, restored.destroy_at), (None, None));
        assert_eq!(restored.trashed_at, None);
    }

    #[test]
    fn a_restored_exploded_note_does_not_explode_again() {
        let mut conn = open_in_memory().unwrap();
        let note = create_fused(&conn, NoteKind::Rich, 1, 0).unwrap();
        assert!(ephemeral::run_maintenance(&mut conn, HOUR).unwrap());
        assert_eq!(
            get(&conn, &note.id).unwrap().trash_reason,
            Some(TrashReason::SelfDestruct)
        );
        restore(&conn, &note.id, 2 * HOUR).unwrap();
        assert!(!ephemeral::run_maintenance(&mut conn, 3 * HOUR).unwrap());
        assert_eq!(ids(&list(&conn, ListFilter::All).unwrap()), [&note.id]);
    }

    #[test]
    fn lit_fuses_are_listed_soonest_first() {
        let conn = open_in_memory().unwrap();
        let week = create_fused(&conn, NoteKind::Rich, 168, 0).unwrap();
        let hour = create_fused(&conn, NoteKind::Rich, 1, 1_000).unwrap();
        let day = create_fused(&conn, NoteKind::Code, 24, 2_000).unwrap();
        create(&conn, NoteKind::Rich, 3_000).unwrap();
        let fused = list(&conn, ListFilter::Ephemeral).unwrap();
        assert_eq!(ids(&fused), [&hour.id, &day.id, &week.id]);
        assert_eq!(fused[0].destroy_at, Some(1_000 + HOUR));
    }

    #[test]
    fn trash_twice_or_restore_outside_the_trash_is_refused() {
        let conn = open_in_memory().unwrap();
        let note = create(&conn, NoteKind::Rich, 0).unwrap();
        assert!(matches!(
            restore(&conn, &note.id, 1),
            Err(Error::InvalidInput(_))
        ));
        trash(&conn, &note.id, 1).unwrap();
        assert!(matches!(
            trash(&conn, &note.id, 2),
            Err(Error::InvalidInput(_))
        ));
        assert!(matches!(trash(&conn, "nope", 2), Err(Error::NotFound(_))));
    }

    #[test]
    fn delete_forever_removes_unsynced_notes() {
        let conn = open_in_memory().unwrap();
        let note = rich_note(&conn, "À jeter", "x", 0);
        assert!(matches!(
            delete_forever(&conn, &note.id, 1),
            Err(Error::InvalidInput(_))
        ));
        trash(&conn, &note.id, 1).unwrap();
        delete_forever(&conn, &note.id, 2).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn delete_forever_leaves_a_tombstone_for_synced_notes() {
        let conn = open_in_memory().unwrap();
        let note = rich_note(&conn, "Synchronisée", "secret", 0);
        conn.execute("UPDATE notes SET server_rev = 7 WHERE id = ?1", [&note.id])
            .unwrap();
        trash(&conn, &note.id, 1).unwrap();
        delete_forever(&conn, &note.id, 2).unwrap();

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
        assert!(matches!(get(&conn, &note.id), Err(Error::NotFound(_))));
        assert!(list(&conn, ListFilter::Trash).unwrap().is_empty());
    }

    #[test]
    fn empty_trash_deletes_only_trashed_notes() {
        let mut conn = open_in_memory().unwrap();
        let keep = create(&conn, NoteKind::Rich, 0).unwrap();
        let first = create(&conn, NoteKind::Rich, 0).unwrap();
        let second = create(&conn, NoteKind::Code, 0).unwrap();
        trash(&conn, &first.id, 1).unwrap();
        trash(&conn, &second.id, 1).unwrap();
        conn.execute(
            "INSERT INTO import_triage (note_id, position) VALUES (?1, 1)",
            [&second.id],
        )
        .unwrap();

        assert_eq!(empty_trash(&mut conn, 2).unwrap(), 2);
        assert_eq!(ids(&list(&conn, ListFilter::All).unwrap()), [&keep.id]);
        assert!(list(&conn, ListFilter::Trash).unwrap().is_empty());
        let triage: i64 = conn
            .query_row("SELECT COUNT(*) FROM import_triage", [], |row| row.get(0))
            .unwrap();
        assert_eq!(triage, 0);
    }
}
