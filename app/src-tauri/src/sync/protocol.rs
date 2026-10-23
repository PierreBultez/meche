//! The JSON exchanged with the server (docs/04): field names in snake_case, dates in
//! milliseconds. These types only describe the wire format; `apply.rs` does the work.

use serde::{Deserialize, Serialize};

use crate::db::notes::{EphemeralMode, Note, NoteColor, NoteKind, TrashReason};

/// Every synced field of a note (docs/03), as the server stores it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncNote {
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
    /// A tombstone: the note was deleted for good (title and content are empty).
    pub deleted: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SyncNote {
    /// Whether two versions hold the same note. `updated_at` is left out, as on the server: two
    /// devices that burnt the same fuse at different moments hold the same note (docs/04).
    pub fn same_as(&self, other: &SyncNote) -> bool {
        SyncNote {
            updated_at: other.updated_at,
            // `..self.clone()`: every other field of `self`, so only updated_at differs.
            ..self.clone()
        } == *other
    }

    /// The note as the rest of the app sees it (`deleted` is not part of a `Note`).
    pub fn to_note(&self) -> Note {
        Note {
            id: self.id.clone(),
            title: self.title.clone(),
            content: self.content.clone(),
            kind: self.kind,
            code_language: self.code_language.clone(),
            pinned: self.pinned,
            color: self.color,
            ephemeral_mode: self.ephemeral_mode,
            ephemeral_delay_hours: self.ephemeral_delay_hours,
            ephemeral_started_at: self.ephemeral_started_at,
            destroy_at: self.destroy_at,
            trashed_at: self.trashed_at,
            trash_reason: self.trash_reason,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

/// A local change sent to the server: the note, and the last revision of it this device knows.
///
/// `#[serde(flatten)]` writes the fields of `note` at the same level as `base_rev`, as the API
/// expects: `{ "id": …, "title": …, "base_rev": 1830 }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Change {
    #[serde(flatten)]
    pub note: SyncNote,
    pub base_rev: i64,
}

/// A note sent by the server, with its revision.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ServerNote {
    #[serde(flatten)]
    pub note: SyncNote,
    pub rev: i64,
}

/// Body of `POST /api/sync`. `'a`: it borrows the changes instead of copying them (they can
/// weigh a few MB); the request cannot outlive them.
#[derive(Debug, Serialize)]
pub struct SyncRequest<'a> {
    pub cursor: i64,
    pub changes: &'a [Change],
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Applied {
    pub id: String,
    pub rev: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Conflict {
    pub id: String,
    pub server: ServerNote,
}

/// Answer of `POST /api/sync` (docs/04).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SyncResponse {
    pub applied: Vec<Applied>,
    pub conflicts: Vec<Conflict>,
    pub changes: Vec<ServerNote>,
    pub cursor: i64,
    pub has_more: bool,
    pub server_time: i64,
    /// Identity of the account's sync history: when it changes, start over (docs/04).
    pub sync_id: String,
    /// The device's cursor is ahead of the server: nothing was applied, start over.
    #[serde(default)]
    pub reset: bool,
}

/// Answer of `POST /api/auth/token` and `POST /api/auth/register`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct TokenResponse {
    pub token: String,
    pub email: String,
    pub sync_id: String,
}

/// Answer of `GET /api/health`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Health {
    pub ok: bool,
    pub api: i64,
    pub server_time: i64,
}

/// A device connected to the account (`GET /api/devices`), sent as is to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct Device {
    pub id: i64,
    pub name: String,
    pub created_at: Option<i64>,
    pub last_used_at: Option<i64>,
    /// This device.
    pub current: bool,
}

#[derive(Debug, Deserialize)]
pub struct Devices {
    pub devices: Vec<Device>,
}

/// An invitation code of the account (`/api/invitations`). `code` is only there right after
/// it was created: the server keeps a hash of it, never the code itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct Invitation {
    pub id: i64,
    #[serde(default)]
    pub code: Option<String>,
    pub hint: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub used_at: Option<i64>,
    pub used_by_email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Invitations {
    pub invitations: Vec<Invitation>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> SyncNote {
        SyncNote {
            id: "0192f1c2-1111-7000-8000-000000000001".to_string(),
            title: "Courses".to_string(),
            content: "- [x] Lait".to_string(),
            kind: NoteKind::Rich,
            code_language: None,
            pinned: false,
            color: NoteColor::Corail,
            ephemeral_mode: Some(EphemeralMode::Delay),
            ephemeral_delay_hours: Some(168),
            ephemeral_started_at: Some(1_761_123_000_000),
            destroy_at: Some(1_761_727_800_000),
            trashed_at: None,
            trash_reason: None,
            deleted: false,
            created_at: 1_761_123_000_000,
            updated_at: 1_761_124_500_000,
        }
    }

    #[test]
    fn a_change_has_the_shape_of_docs_04() {
        let change = Change {
            note: sample(),
            base_rev: 1830,
        };
        assert_eq!(
            serde_json::to_value(&change).unwrap(),
            json!({
                "id": "0192f1c2-1111-7000-8000-000000000001",
                "base_rev": 1830,
                "title": "Courses",
                "content": "- [x] Lait",
                "kind": "rich",
                "code_language": null,
                "pinned": false,
                "color": "corail",
                "ephemeral_mode": "delay",
                "ephemeral_delay_hours": 168,
                "ephemeral_started_at": 1_761_123_000_000_i64,
                "destroy_at": 1_761_727_800_000_i64,
                "trashed_at": null,
                "trash_reason": null,
                "deleted": false,
                "created_at": 1_761_123_000_000_i64,
                "updated_at": 1_761_124_500_000_i64
            })
        );
    }

    #[test]
    fn reads_an_answer_of_the_server() {
        let mut note = serde_json::to_value(sample()).unwrap();
        note["rev"] = json!(1843);
        let answer: SyncResponse = serde_json::from_value(json!({
            "applied": [{ "id": "a", "rev": 1843 }],
            "conflicts": [{ "id": "b", "server": note }],
            "changes": [note],
            "cursor": 1843,
            "has_more": false,
            "server_time": 1_761_124_501_234_i64,
            "sync_id": "0192f1c2-aaaa-7000-8000-000000000000",
            "reset": false
        }))
        .unwrap();
        assert_eq!(answer.conflicts[0].server.rev, 1843);
        assert_eq!(answer.changes[0].note, sample());
    }

    #[test]
    fn two_versions_differing_only_by_updated_at_are_the_same() {
        let later = SyncNote {
            updated_at: 1,
            ..sample()
        };
        assert!(sample().same_as(&later));
        let pinned = SyncNote {
            pinned: true,
            ..sample()
        };
        assert!(!sample().same_as(&pinned));
    }
}
