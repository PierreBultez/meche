//! Reading a Standard Notes backup (docs/07, sections 1 and 2).
//!
//! Standard Notes saves a `.zip` holding `Standard Notes Backup and Import File.txt` (the whole
//! backup, as JSON) and one file per item under `Items/` (copies, ignored). The extracted `.txt`
//! can be chosen too, as can a `.json`. Only the notes are sent to the frontend, which converts
//! them: attached files (with their decryption keys), extensions and preferences stay here.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Seek};
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};

/// Largest backup read (the JSON text). A backup of several thousand notes stays well below;
/// the limit protects the app from a huge file, or a zip that would expand without end.
pub const MAX_BACKUP_BYTES: u64 = 64 * 1024 * 1024;

/// Name of the backup inside the zip of Standard Notes.
const MAIN_FILE_NAME: &str = "Standard Notes Backup and Import File.txt";

/// What the frontend receives from a backup.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    /// The backup's format version (`"004"`), when it says.
    pub version: Option<String>,
    /// The `Note` items, as they are in the backup (without their HTML preview).
    pub notes: Vec<Value>,
    /// How many items of every other type were left out (`"SN|File": 34`…), for the summary.
    pub other_items: BTreeMap<String, usize>,
}

/// Why a file cannot be imported. The code becomes the error's `kind`, so the frontend can show
/// its French message.
fn not_a_backup() -> Error {
    Error::Backup("backup_invalid")
}

/// Reads the backup at `path`: a zip from Standard Notes, or its JSON file.
pub fn read(path: &Path) -> Result<Backup> {
    read_with_limit(path, MAX_BACKUP_BYTES)
}

/// `read` with another size limit (the tests use a small one).
fn read_with_limit(path: &Path, max_bytes: u64) -> Result<Backup> {
    let mut file = File::open(path)?;
    let mut start = [0u8; 4];
    let is_zip = file.read(&mut start)? == 4 && start == *b"PK\x03\x04";
    file.rewind()?;
    if is_zip {
        return read_zip(file, max_bytes);
    }
    let text = read_limited(file, max_bytes)?;
    parse(&text)
}

/// Reads at most `max_bytes` of `reader` as UTF-8 text. One byte more than the limit is read:
/// the sizes written in a zip cannot be trusted, only what really comes out.
fn read_limited(reader: impl Read, max_bytes: u64) -> Result<String> {
    let mut bytes = Vec::new();
    reader.take(max_bytes + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(Error::Backup("backup_too_large"));
    }
    // A byte order mark (some editors add one) is not part of the JSON.
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    String::from_utf8(bytes.to_vec()).map_err(|_| not_a_backup())
}

/// The backup inside a zip: the file named like Standard Notes names it, otherwise the first
/// `.txt` or `.json` at the root of the archive that is a backup.
///
/// `impl Read + Seek`: any source that can be read and moved in (a file here, bytes in memory
/// in the tests). `zip` needs to seek, because the list of files is at the end of an archive.
fn read_zip(source: impl Read + Seek, max_bytes: u64) -> Result<Backup> {
    let mut archive = zip::ZipArchive::new(source).map_err(|_| not_a_backup())?;
    // A name that cannot be decoded is skipped (`ok()` turns the error into `None`). `Cow` is a
    // borrowed or owned text: `into_owned` gives a `String` that no longer borrows `archive`.
    let mut candidates: Vec<String> = archive
        .file_names()
        .filter_map(|name| name.ok())
        .map(|name| name.into_owned())
        .filter(|name| {
            let lower = name.to_lowercase();
            !name.contains('/') && (lower.ends_with(".txt") || lower.ends_with(".json"))
        })
        .collect();
    // `sort_by_key` with a bool: `false` sorts first, so the main file comes first.
    candidates.sort_by_key(|name| name != MAIN_FILE_NAME);
    for name in candidates {
        let entry = archive.by_name(&name).map_err(|_| not_a_backup())?;
        let text = read_limited(entry, max_bytes)?;
        match parse(&text) {
            Err(Error::Backup("backup_invalid")) => continue,
            other => return other,
        }
    }
    Err(not_a_backup())
}

/// Checks that `text` is a decrypted Standard Notes backup and keeps its notes.
fn parse(text: &str) -> Result<Backup> {
    let mut root: Value = serde_json::from_str(text).map_err(|_| not_a_backup())?;
    let version = root
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string);
    // `take()` moves the items out of `root` instead of copying them.
    let Some(Value::Array(items)) = root.get_mut("items").map(Value::take) else {
        return Err(not_a_backup());
    };
    let mut notes = Vec::new();
    let mut other_items = BTreeMap::new();
    for mut item in items {
        // An encrypted backup keeps every content as an encrypted string ("004:…").
        if item.get("content").is_some_and(Value::is_string) || item.get("enc_item_key").is_some() {
            return Err(Error::Backup("backup_encrypted"));
        }
        let content_type = item
            .get("content_type")
            .and_then(Value::as_str)
            .unwrap_or("?")
            .to_string();
        if content_type == "Note" {
            // The HTML preview is a copy of the beginning of the note: not needed.
            if let Some(content) = item.get_mut("content").and_then(Value::as_object_mut) {
                content.remove("preview_html");
            }
            notes.push(item);
        } else {
            *other_items.entry(content_type).or_insert(0) += 1;
        }
    }
    if notes.is_empty() && other_items.is_empty() && root.get("keyParams").is_some() {
        return Err(Error::Backup("backup_encrypted"));
    }
    Ok(Backup {
        version,
        notes,
        other_items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    const BACKUP: &str = r#"{
      "version": "004",
      "items": [
        { "uuid": "6f1c3a52-9d4e-4b8a-a1f0-2c3d4e5f6a7b", "content_type": "Note",
          "content": { "title": "Courses", "text": "Lait", "noteType": "plain-text",
                       "preview_html": "<p>Lait</p>", "preview_plain": "Lait" } },
        { "uuid": "0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a", "content_type": "SN|File",
          "content": { "name": "photo.jpg", "key": "secret" } },
        { "uuid": "a0b1c2d3-e4f5-4a6b-8c7d-8e9fa0b1c2d3", "content_type": "SN|File",
          "content": { "name": "plan.odt", "key": "secret" } },
        { "uuid": "b1c2d3e4-f5a6-4b7c-9d8e-9fa0b1c2d3e4", "content_type": "SN|Component",
          "content": {} }
      ]
    }"#;

    fn write_file(dir: &Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    /// A zip like the one of Standard Notes: `entries` are (name, text).
    fn zip_of(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, text) in entries {
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            writer.start_file(*name, options).unwrap();
            writer.write_all(text.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn keeps_only_the_notes_and_counts_the_rest() {
        let backup = parse(BACKUP).unwrap();
        assert_eq!(backup.version.as_deref(), Some("004"));
        assert_eq!(backup.notes.len(), 1);
        assert_eq!(backup.notes[0]["content"]["title"], "Courses");
        assert!(backup.notes[0]["content"].get("preview_html").is_none());
        assert_eq!(backup.other_items["SN|File"], 2);
        assert_eq!(backup.other_items["SN|Component"], 1);
        // The keys of the attached files never reach the frontend.
        assert!(!serde_json::to_string(&backup).unwrap().contains("secret"));
    }

    #[test]
    fn reads_the_text_file_and_the_zip_of_standard_notes() {
        let dir = tempfile::tempdir().unwrap();
        let text = write_file(dir.path(), "backup.txt", BACKUP.as_bytes());
        let with_bom = write_file(
            dir.path(),
            "bom.json",
            &[b"\xEF\xBB\xBF".as_slice(), BACKUP.as_bytes()].concat(),
        );
        let zip = write_file(
            dir.path(),
            "Standard Notes Backup - Sun Oct 25 2026.zip",
            &zip_of(&[
                (
                    "Items/Note/Courses-6f1c3a52.txt",
                    "{\"not\": \"the backup\"}",
                ),
                ("notes.txt", "not JSON"),
                (MAIN_FILE_NAME, BACKUP),
            ]),
        );
        for path in [text, with_bom, zip] {
            assert_eq!(read(&path).unwrap(), parse(BACKUP).unwrap());
        }
    }

    #[test]
    fn a_zip_with_another_name_for_the_backup_is_read_too() {
        let backup = read_zip(Cursor::new(zip_of(&[("export.json", BACKUP)])), 1 << 20).unwrap();
        assert_eq!(backup.notes.len(), 1);
    }

    #[test]
    fn refuses_files_that_are_not_backups() {
        let cases: [&[u8]; 6] = [
            b"",
            b"just some text",
            b"{\"items\": 3}",
            b"[1, 2, 3]",
            b"\xFF\xFE not UTF-8",
            b"PK\x03\x04 a broken zip",
        ];
        let dir = tempfile::tempdir().unwrap();
        for (index, bytes) in cases.iter().enumerate() {
            let path = write_file(dir.path(), &format!("{index}.txt"), bytes);
            assert!(
                matches!(read(&path), Err(Error::Backup("backup_invalid"))),
                "case {index}"
            );
        }
        let no_backup = zip_of(&[("Items/Note/a.txt", BACKUP), ("readme.md", "hello")]);
        assert!(matches!(
            read_zip(Cursor::new(no_backup), 1 << 20),
            Err(Error::Backup("backup_invalid"))
        ));
    }

    #[test]
    fn recognizes_an_encrypted_backup() {
        let encrypted = r#"{ "version": "004", "keyParams": { "identifier": "x" },
          "items": [ { "uuid": "u", "content_type": "Note", "content": "004:abc:def",
                       "enc_item_key": "004:ghi" } ] }"#;
        assert!(matches!(
            parse(encrypted),
            Err(Error::Backup("backup_encrypted"))
        ));
    }

    #[test]
    fn refuses_a_backup_larger_than_the_limit_even_in_a_zip() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_file(dir.path(), "backup.txt", BACKUP.as_bytes());
        let limit = BACKUP.len() as u64 - 1;
        assert!(matches!(
            read_with_limit(&path, limit),
            Err(Error::Backup("backup_too_large"))
        ));
        assert_eq!(read_with_limit(&path, limit + 1).unwrap().notes.len(), 1);
        // A small zip that expands a lot: stopped at the limit, whatever its header says.
        let big = format!("{BACKUP}{}", " ".repeat(1 << 20));
        let zip = zip_of(&[(MAIN_FILE_NAME, &big)]);
        assert!(zip.len() < 10_000);
        assert!(matches!(
            read_zip(Cursor::new(zip), 1 << 16),
            Err(Error::Backup("backup_too_large"))
        ));
    }
}
