//! One sync with the server, logging in and logging out: the work the engine (engine.rs) does,
//! written as plain functions of the shared database and the HTTP client. The engine adds when
//! to sync and tells the interface; these functions are tested here without the Tauri app,
//! with an in-memory database and a local test server.

use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::Connection;

use super::api::Api;
use super::apply::{self, MAX_CHANGE_BYTES, MAX_CHANGES, Unacknowledged};
use super::config;
use super::protocol::SyncRequest;
use crate::error::{Error, Result};
use crate::time::now_ms;

/// Logging out tells the server, but never waits long for it.
pub const LOGOUT_TIMEOUT: Duration = Duration::from_secs(5);
/// Versions remembered per note while answers are lost (see `sync_round`): the oldest ones go
/// first. Forgetting one only risks a conflict copy, never a loss.
const MAX_UNACKNOWLEDGED_VERSIONS: usize = 3;
const DEVICE_NAME_MAX_CHARS: usize = 100;

/// Locks the database for a few milliseconds (as `AppState::lock_db`). The guard must be dropped
/// before any `.await`: the compiler refuses to keep it across one in a tokio task.
pub fn lock(db: &Mutex<Connection>) -> Result<MutexGuard<'_, Connection>> {
    db.lock().map_err(|_| Error::DatabaseLockPoisoned)
}

/// What one request did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Round {
    /// Notes changed on screen: tell the interface.
    pub changed: bool,
    /// Conflict copies created.
    pub conflicts: usize,
    /// Another request must follow at once (more to send or to receive, a reset).
    pub again: bool,
    /// The server moved on: its cursor advanced, or it accepted changes. A server that keeps
    /// saying there is more without moving on is not asked again and again.
    pub progress: bool,
    /// The server's clock, when it answered.
    pub server_time: Option<i64>,
}

/// One request (docs/04): sends a batch of local changes, applies the answer.
///
/// `unacknowledged` lives in the engine between requests: the versions sent whose answer did
/// not come back, so that the server sending one of them back is not taken for another
/// device's version.
pub async fn sync_round(
    db: &Mutex<Connection>,
    api: &Api,
    unacknowledged: &mut Unacknowledged,
) -> Result<Round> {
    // 1. What to send. The block ends, the guard is dropped, the lock is released.
    let (config, batch) = {
        let conn = lock(db)?;
        (
            config::load(&conn)?,
            apply::collect_changes(&conn, MAX_CHANGES, MAX_CHANGE_BYTES)?,
        )
    };
    let Some((server_url, token)) = config.session() else {
        return Ok(Round::default());
    };
    // Remembered until the answer is applied. `entry(…).or_default()`: the list of this note,
    // created empty the first time.
    let mut added = Vec::new();
    for change in &batch.changes {
        let versions = unacknowledged.entry(change.note.id.clone()).or_default();
        if versions.last() != Some(&change.note) {
            versions.push(change.note.clone());
            if versions.len() > MAX_UNACKNOWLEDGED_VERSIONS {
                versions.remove(0);
            }
            added.push(change.note.id.clone());
        }
    }

    // 2. The request, without the lock: the commands and the fuse go on meanwhile.
    let request = SyncRequest {
        cursor: config.cursor,
        sync_id: config.sync_id.as_deref(),
        changes: &batch.changes,
    };
    let response = match api.sync(server_url, token, &request).await {
        Ok(response) => response,
        Err(error) => {
            // The server refused the request (4xx: invalid, unauthorized, too many requests):
            // it applied nothing, so these versions are not waiting for anything. Any other
            // error keeps them: the request may have been applied before the answer was lost
            // (a network error, or a 502 / 504 from Nginx while PHP went on).
            if matches!(
                error,
                Error::Api {
                    status: 400..=499,
                    ..
                }
            ) {
                for id in &added {
                    if let Some(versions) = unacknowledged.get_mut(id) {
                        versions.pop();
                        if versions.is_empty() {
                            unacknowledged.remove(id);
                        }
                    }
                }
            }
            return Err(error);
        }
    };

    // 3. The answer, in one transaction.
    let mut conn = lock(db)?;
    if response.reset || config.sync_id.as_deref() != Some(response.sync_id.as_str()) {
        // Another history on the server (database recreated or restored): send everything
        // again from the start (docs/04).
        eprintln!("the server's sync history changed: starting over");
        let tx = conn.transaction()?;
        apply::reset(&tx, &response.sync_id)?;
        tx.commit()?;
        unacknowledged.clear();
        // Not progress: a server answering « start over » every time must not be asked again
        // and again (the requests that follow, sending the notes, are).
        return Ok(Round {
            again: true,
            server_time: Some(response.server_time),
            ..Round::default()
        });
    }
    let outcome = apply::apply_response(
        &mut conn,
        &batch.changes,
        &response,
        now_ms(),
        unacknowledged,
    )?;
    // The server answered for everything sent: nothing of it is waiting any more.
    for change in &batch.changes {
        unacknowledged.remove(&change.note.id);
    }
    Ok(Round {
        changed: outcome.changed,
        conflicts: outcome.conflict_copies,
        // Conflict copies are new local notes, and a version recognised after a lost answer
        // may leave a note to send: they go at once too.
        again: response.has_more || batch.more || outcome.conflict_copies > 0 || outcome.resend,
        progress: response.cursor != config.cursor || !response.applied.is_empty(),
        server_time: Some(response.server_time),
    })
}

/// What the user typed to log in, or to create an account (with an invitation code).
pub struct Login {
    pub server_url: String,
    pub email: String,
    pub password: String,
    pub device_name: String,
    pub invitation_code: Option<String>,
}

/// A successful login.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoggedIn {
    pub server_url: String,
    pub email: String,
    pub device_name: String,
    pub last_sync_at: Option<i64>,
    /// The notes of this device go to an account they were not synced with: all sent again.
    pub reset: bool,
}

/// Logs in (or creates an account), then remembers the server, the account and the token.
/// A failed login changes nothing: the device stays connected as before, if it was.
pub async fn log_in(db: &Mutex<Connection>, api: &Api, login: Login) -> Result<LoggedIn> {
    let server_url = config::normalize_server_url(&login.server_url)?;
    let email = login.email.trim();
    let device_name: String = match login.device_name.trim() {
        "" => config::default_device_name(),
        name => name.chars().take(DEVICE_NAME_MAX_CHARS).collect(),
    };
    let previous = config::load(&*lock(db)?)?;
    let answer = match &login.invitation_code {
        Some(code) => {
            api.register(&server_url, code, email, &login.password, &device_name)
                .await?
        }
        None => {
            api.login(&server_url, email, &login.password, &device_name)
                .await?
        }
    };

    let (reset, last_sync_at) = {
        let mut conn = lock(db)?;
        let tx = conn.transaction()?;
        // Another account or another server than last time: every note of this device goes to
        // this account, as if it had never been synced (docs/04). The first login is such a
        // case, with nothing to change: no note was ever synced.
        let reset = previous.sync_id.as_deref() != Some(answer.sync_id.as_str());
        if reset {
            apply::reset(&tx, &answer.sync_id)?;
        }
        config::save_login(
            &tx,
            &server_url,
            &answer.token,
            &answer.email,
            &device_name,
            &answer.sync_id,
        )?;
        let last_sync_at = config::load(&tx)?.last_sync_at;
        tx.commit()?;
        (reset, last_sync_at)
    };

    // The previous token (another account, another server) is given back only now that the
    // new one works. Best effort: offline, it expires after 180 days unused.
    if let Some((url, token)) = previous.session() {
        let _ = tokio::time::timeout(LOGOUT_TIMEOUT, api.logout(url, token)).await;
    }
    Ok(LoggedIn {
        server_url,
        email: answer.email,
        device_name,
        last_sync_at,
        reset,
    })
}

/// Logs this device out: the server forgets its token (best effort), the device too. Its notes,
/// the server, the account and the cursor stay: logging in again goes on where it stopped.
pub async fn log_out(db: &Mutex<Connection>, api: &Api) -> Result<()> {
    let config = config::load(&*lock(db)?)?;
    if let Some((url, token)) = config.session() {
        let _ = tokio::time::timeout(LOGOUT_TIMEOUT, api.logout(url, token)).await;
    }
    config::forget_token(&*lock(db)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::{self, NoteKind, NotePatch};
    use crate::db::open_in_memory;
    use crate::sync::test_server::serve;
    use serde_json::json;

    fn run<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    /// A database logged in with history `sync_id` (to a server set later by `point_to`), and
    /// one note never synced.
    fn connected(sync_id: &str) -> (Mutex<Connection>, String) {
        let conn = open_in_memory().unwrap();
        config::save_login(
            &conn,
            "http://127.0.0.1:1",
            "1|meche_old",
            "p@example.com",
            "PC",
            sync_id,
        )
        .unwrap();
        let note = notes::create(&conn, NoteKind::Rich, 1_000).unwrap();
        let patch = NotePatch {
            title: Some("Courses".to_string()),
            ..NotePatch::default()
        };
        notes::update(&conn, &note.id, patch, 1_000).unwrap();
        (Mutex::new(conn), note.id)
    }

    /// The device syncs with the test server at `base`.
    fn point_to(db: &Mutex<Connection>, base: &str) {
        let conn = lock(db).unwrap();
        let config = config::load(&conn).unwrap();
        config::save_login(
            &conn,
            base,
            config.token.as_deref().unwrap(),
            "p@example.com",
            "PC",
            config.sync_id.as_deref().unwrap(),
        )
        .unwrap();
    }

    fn answer(sync_id: &str, extra: serde_json::Value) -> String {
        let mut body = json!({
            "applied": [], "conflicts": [], "changes": [], "cursor": 0,
            "has_more": false, "server_time": 1, "sync_id": sync_id, "reset": false
        });
        for (key, value) in extra.as_object().unwrap() {
            body[key] = value.clone();
        }
        body.to_string()
    }

    fn state(db: &Mutex<Connection>, id: &str) -> (i64, bool) {
        lock(db)
            .unwrap()
            .query_row(
                "SELECT server_rev, dirty FROM notes WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
    }

    /// The note `id` as this device would send it, as the server would answer it at `rev`.
    fn served(db: &Mutex<Connection>, id: &str, rev: i64) -> serde_json::Value {
        let conn = lock(db).unwrap();
        let change = apply::collect_changes(&conn, 200, i64::MAX)
            .unwrap()
            .changes
            .into_iter()
            .find(|change| change.note.id == id)
            .unwrap();
        let mut note = serde_json::to_value(change.note).unwrap();
        note["rev"] = json!(rev);
        note
    }

    fn edit(db: &Mutex<Connection>, id: &str, content: &str) {
        let patch = NotePatch {
            content: Some(content.to_string()),
            ..NotePatch::default()
        };
        notes::update(&lock(db).unwrap(), id, patch, 2_000).unwrap();
    }

    fn count_notes(db: &Mutex<Connection>) -> i64 {
        lock(db)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn sends_the_notes_with_the_known_history_and_keeps_the_cursor() {
        let (db, id) = connected("s1");
        let (base, server) = serve(vec![(
            "200 OK",
            answer(
                "s1",
                json!({ "applied": [{ "id": id, "rev": 3 }], "cursor": 3 }),
            ),
        )]);
        point_to(&db, &base);

        let mut unacknowledged = Unacknowledged::new();
        let round = run(sync_round(&db, &Api::new(), &mut unacknowledged)).unwrap();

        assert_eq!(
            round,
            Round {
                progress: true,
                server_time: Some(1),
                ..Round::default()
            }
        );
        assert_eq!(state(&db, &id), (3, false));
        assert_eq!(config::load(&lock(&db).unwrap()).unwrap().cursor, 3);
        assert!(unacknowledged.is_empty());
        let request = &server.join().unwrap()[0];
        assert_eq!(request.line, "POST /api/sync HTTP/1.1");
        assert!(
            request
                .headers
                .to_lowercase()
                .contains("authorization: bearer 1|meche_old")
        );
        assert_eq!(request.json()["sync_id"], "s1");
        assert_eq!(request.json()["changes"][0]["base_rev"], 0);
    }

    #[test]
    fn another_history_on_the_server_sends_everything_again() {
        let (db, id) = connected("s1");
        let (base, server) = serve(vec![
            (
                "200 OK",
                answer(
                    "s1",
                    json!({ "applied": [{ "id": id, "rev": 3 }], "cursor": 3 }),
                ),
            ),
            // The database was recreated: another identity.
            ("200 OK", answer("s2", json!({}))),
            (
                "200 OK",
                answer(
                    "s2",
                    json!({ "applied": [{ "id": id, "rev": 1 }], "cursor": 1 }),
                ),
            ),
        ]);
        point_to(&db, &base);
        let api = Api::new();
        let mut unacknowledged = Unacknowledged::new();
        run(sync_round(&db, &api, &mut unacknowledged)).unwrap();

        let reset = run(sync_round(&db, &api, &mut unacknowledged)).unwrap();
        assert!(reset.again);
        assert_eq!(state(&db, &id), (0, true));
        run(sync_round(&db, &api, &mut unacknowledged)).unwrap();

        let requests = server.join().unwrap();
        assert_eq!(requests[1].json()["changes"].as_array().unwrap().len(), 0);
        // Sent again as never synced, with the new history.
        assert_eq!(requests[2].json()["sync_id"], "s2");
        assert_eq!(requests[2].json()["cursor"], 0);
        assert_eq!(requests[2].json()["changes"][0]["base_rev"], 0);
        assert_eq!(state(&db, &id), (1, false));
    }

    #[test]
    fn a_reset_answer_starts_over() {
        let (db, id) = connected("s1");
        lock(&db)
            .unwrap()
            .execute("UPDATE notes SET server_rev = 9, dirty = 0", [])
            .unwrap();
        config::save_cursor(&lock(&db).unwrap(), 9).unwrap();
        let (base, server) = serve(vec![("200 OK", answer("s2", json!({ "reset": true })))]);
        point_to(&db, &base);

        let round = run(sync_round(&db, &Api::new(), &mut Unacknowledged::new())).unwrap();

        assert!(round.again);
        assert_eq!(state(&db, &id), (0, true));
        let config = config::load(&lock(&db).unwrap()).unwrap();
        assert_eq!((config.cursor, config.sync_id.as_deref()), (0, Some("s2")));
        assert_eq!(config.last_sync_at, None);
        server.join().unwrap();
    }

    #[test]
    fn an_edit_after_a_lost_answer_is_not_a_conflict() {
        let (db, id) = connected("s1");
        let lost = served(&db, &id, 5);
        let (base, server) = serve(vec![
            // The server stored the note (rev 5), but its answer never arrived.
            ("500 Internal Server Error", "{}".to_string()),
            (
                "200 OK",
                answer(
                    "s1",
                    json!({ "conflicts": [{ "id": id, "server": lost }], "changes": [lost], "cursor": 5 }),
                ),
            ),
            (
                "200 OK",
                answer(
                    "s1",
                    json!({ "applied": [{ "id": id, "rev": 6 }], "cursor": 6 }),
                ),
            ),
        ]);
        point_to(&db, &base);
        let api = Api::new();
        let mut unacknowledged = Unacknowledged::new();
        assert!(run(sync_round(&db, &api, &mut unacknowledged)).is_err());
        edit(&db, &id, "Plus récent");

        let round = run(sync_round(&db, &api, &mut unacknowledged)).unwrap();
        assert_eq!(round.conflicts, 0);
        // The newer version goes at once, not a minute later.
        assert!(round.again);
        assert_eq!(count_notes(&db), 1);
        assert_eq!(state(&db, &id), (5, true));
        run(sync_round(&db, &api, &mut unacknowledged)).unwrap();

        let requests = server.join().unwrap();
        assert_eq!(requests[2].json()["changes"][0]["base_rev"], 5);
        assert_eq!(requests[2].json()["changes"][0]["content"], "Plus récent");
        assert_eq!(state(&db, &id), (6, false));
    }

    #[test]
    fn a_refused_request_forgets_what_it_sent() {
        let (db, _) = connected("s1");
        let (base, server) = serve(vec![(
            "422 Unprocessable Content",
            r#"{"error":"invalid_change","message":"changes.0.color"}"#.to_string(),
        )]);
        point_to(&db, &base);
        let mut unacknowledged = Unacknowledged::new();

        let error = run(sync_round(&db, &Api::new(), &mut unacknowledged)).unwrap_err();

        assert_eq!(error.kind(), "invalid_change");
        // The server applied nothing: no version is waiting for an answer.
        assert!(unacknowledged.is_empty());
        server.join().unwrap();
    }

    #[test]
    fn unanswered_requests_keep_a_few_versions_per_note() {
        // `connected` points to a port where nothing listens: every request fails.
        let (db, id) = connected("s1");
        let api = Api::new();
        let mut unacknowledged = Unacknowledged::new();
        for attempt in 0..6 {
            edit(&db, &id, &format!("Version {attempt}"));
            assert_eq!(
                run(sync_round(&db, &api, &mut unacknowledged))
                    .unwrap_err()
                    .kind(),
                "network"
            );
        }
        let versions = &unacknowledged[&id];
        assert_eq!(versions.len(), MAX_UNACKNOWLEDGED_VERSIONS);
        assert_eq!(versions.last().unwrap().content, "Version 5");
    }

    #[test]
    fn conflict_copies_are_sent_at_once() {
        let (db, id) = connected("s1");
        lock(&db)
            .unwrap()
            .execute("UPDATE notes SET server_rev = 4 WHERE id = ?1", [&id])
            .unwrap();
        let mut theirs = served(&db, &id, 5);
        theirs["title"] = json!("Version d'ailleurs");
        let (base, server) = serve(vec![(
            "200 OK",
            answer(
                "s1",
                json!({ "conflicts": [{ "id": id, "server": theirs }], "cursor": 5 }),
            ),
        )]);
        point_to(&db, &base);

        let round = run(sync_round(&db, &Api::new(), &mut Unacknowledged::new())).unwrap();

        assert_eq!(
            (round.conflicts, round.again, round.changed),
            (1, true, true)
        );
        assert_eq!(count_notes(&db), 2);
        server.join().unwrap();
    }

    #[test]
    fn a_revoked_device_is_told_so() {
        let (db, _) = connected("s1");
        let (base, server) = serve(vec![(
            "401 Unauthorized",
            r#"{"message":"Unauthenticated."}"#.to_string(),
        )]);
        point_to(&db, &base);

        let error = run(sync_round(&db, &Api::new(), &mut Unacknowledged::new())).unwrap_err();

        assert_eq!(error.kind(), "unauthorized");
        server.join().unwrap();
    }

    fn login(base: &str) -> Login {
        Login {
            server_url: base.to_string(),
            email: " p@example.com ".to_string(),
            password: "secret".to_string(),
            device_name: " PC ".to_string(),
            invitation_code: None,
        }
    }

    fn token_answer(sync_id: &str) -> String {
        json!({ "token": "2|meche_new", "email": "p@example.com", "sync_id": sync_id }).to_string()
    }

    #[test]
    fn logging_in_again_to_the_same_history_goes_on_where_it_stopped() {
        let (db, id) = connected("s1");
        lock(&db)
            .unwrap()
            .execute("UPDATE notes SET server_rev = 4, dirty = 0", [])
            .unwrap();
        config::forget_token(&lock(&db).unwrap()).unwrap();
        let (base, server) = serve(vec![("200 OK", token_answer("s1"))]);

        let logged = run(log_in(&db, &Api::new(), login(&base))).unwrap();

        assert!(!logged.reset);
        assert_eq!(logged.device_name, "PC");
        assert_eq!(state(&db, &id), (4, false));
        let request = &server.join().unwrap()[0];
        assert_eq!(request.json()["email"], "p@example.com");
        let config = config::load(&lock(&db).unwrap()).unwrap();
        assert_eq!(config.token.as_deref(), Some("2|meche_new"));
    }

    #[test]
    fn another_account_gets_every_note_and_the_old_token_is_given_back_after() {
        let (db, id) = connected("s1");
        lock(&db)
            .unwrap()
            .execute("UPDATE notes SET server_rev = 4, dirty = 0", [])
            .unwrap();
        let (base, server) = serve(vec![
            ("200 OK", token_answer("other")),
            ("204 No Content", String::new()),
        ]);
        point_to(&db, &base);

        let logged = run(log_in(&db, &Api::new(), login(&base))).unwrap();

        assert!(logged.reset);
        assert_eq!(state(&db, &id), (0, true));
        let requests = server.join().unwrap();
        assert_eq!(requests[0].line, "POST /api/auth/token HTTP/1.1");
        assert_eq!(requests[1].line, "DELETE /api/auth/token HTTP/1.1");
        assert!(
            requests[1]
                .headers
                .to_lowercase()
                .contains("authorization: bearer 1|meche_old")
        );
    }

    #[test]
    fn a_failed_login_keeps_the_device_connected_as_before() {
        let (db, _) = connected("s1");
        let (base, server) = serve(vec![(
            "401 Unauthorized",
            r#"{"error":"invalid_credentials"}"#.to_string(),
        )]);
        point_to(&db, &base);

        let error = run(log_in(&db, &Api::new(), login(&base))).unwrap_err();

        assert_eq!(error.kind(), "invalid_credentials");
        assert_eq!(server.join().unwrap().len(), 1);
        let config = config::load(&lock(&db).unwrap()).unwrap();
        assert_eq!(config.token.as_deref(), Some("1|meche_old"));
    }
}
