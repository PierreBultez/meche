//! The sync engine (docs/04): one tokio task owns the sync.
//!
//! Commands and the fuse watcher never sync themselves: they send messages to this task through
//! a channel ("a local change", "the window came back", "sync now", "log in"…). The task
//! handles them one at a time, so two syncs can never run together, and a request that arrives
//! during a sync simply waits in the channel until it ends (docs/04: "reprogramme une à la
//! fin"). Login and logout go through it too: a sync can never be half way when the account
//! changes.
//!
//! The task shares the SQLite connection with the commands: it takes the `Mutex` only for the
//! few milliseconds it reads or writes notes, never while it waits for the network.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

use super::api::Api;
use super::apply::{self, MAX_CHANGE_BYTES, MAX_CHANGES};
use super::config::{self, SyncConfig};
use super::protocol::SyncRequest;
use super::schedule::Schedule;
use crate::AppState;
use crate::ephemeral::watcher::notify_notes_changed;
use crate::error::{Error, Result};
use crate::time::now_ms;

/// Event sent to the frontend whenever the state of the sync changes (docs/02).
pub const SYNC_STATUS: &str = "sync-status";

/// Requests in a row without waiting (more than one batch to send, `has_more`): a safety
/// net against a loop; the periodic sync goes on afterwards.
const MAX_ROUNDS: usize = 20;
/// Beyond 5 minutes of difference with the server's clock, fuses burn noticeably early or late.
const CLOCK_SKEW_WARNING_MS: i64 = 5 * 60 * 1000;
/// Logging out tells the server, but never waits long for it.
const LOGOUT_TIMEOUT: Duration = Duration::from_secs(5);
const DEVICE_NAME_MAX_CHARS: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncState {
    Idle,
    Syncing,
    Offline,
    Error,
}

/// The state of the sync, as the frontend shows it (the dot of the list, the settings).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub state: SyncState,
    /// `kind` of the last error (`network`, `unauthorized`…): the frontend writes its message.
    pub error_kind: Option<String>,
    /// Technical detail of the last error, for the console.
    pub message: Option<String>,
    pub logged_in: bool,
    pub server_url: Option<String>,
    pub email: Option<String>,
    pub device_name: String,
    pub last_sync_at: Option<i64>,
    /// Difference with the server's clock, when it is over 5 minutes (docs/04).
    pub clock_skew_ms: Option<i64>,
    /// Conflict copies created by the sync that has just ended (only in that event).
    pub conflicts: usize,
}

impl SyncStatus {
    fn from_config(config: &SyncConfig) -> SyncStatus {
        SyncStatus {
            state: SyncState::Idle,
            error_kind: None,
            message: None,
            logged_in: config.token.is_some(),
            server_url: config.server_url.clone(),
            email: config.email.clone(),
            device_name: config
                .device_name
                .clone()
                .unwrap_or_else(config::default_device_name),
            last_sync_at: config.last_sync_at,
            clock_skew_ms: None,
            conflicts: 0,
        }
    }
}

/// What the user typed to log in, or to create an account (with an invitation code).
pub struct Login {
    pub server_url: String,
    pub email: String,
    pub password: String,
    pub device_name: String,
    pub invitation_code: Option<String>,
}

/// Messages to the engine. Those that wait for an answer carry a `oneshot` sender: a channel
/// for a single value, on which the engine sends the result back.
enum Request {
    LocalChange,
    Focus,
    SyncNow(oneshot::Sender<SyncStatus>),
    Login(Login, oneshot::Sender<Result<SyncStatus>>),
    Logout(oneshot::Sender<SyncStatus>),
}

/// The engine's handle, kept in `AppState`: commands use it to talk to the engine. It is
/// `Clone`: every clone sends to the same task.
#[derive(Clone)]
pub struct SyncHandle {
    requests: mpsc::UnboundedSender<Request>,
    /// The current status. A std `Mutex`, only held for a copy, never across an `.await`.
    status: Arc<Mutex<SyncStatus>>,
    /// The shared HTTP client, also used directly for requests outside the sync (devices…).
    pub api: Api,
}

/// The task itself, before it starts.
pub struct Engine {
    requests: mpsc::UnboundedReceiver<Request>,
    status: Arc<Mutex<SyncStatus>>,
    api: Api,
    schedule: Schedule,
}

/// Creates the engine and its handle. `spawn` starts the engine once `AppState` is managed.
pub fn create(api: Api, config: &SyncConfig) -> (SyncHandle, Engine) {
    // An unbounded channel: sending never waits, so commands and the watcher thread can send
    // from anywhere. The messages are tiny and the engine reads them as they come.
    let (sender, receiver) = mpsc::unbounded_channel();
    let status = Arc::new(Mutex::new(SyncStatus::from_config(config)));
    let handle = SyncHandle {
        requests: sender,
        status: Arc::clone(&status),
        api: api.clone(),
    };
    let engine = Engine {
        requests: receiver,
        status,
        api,
        schedule: Schedule::default(),
    };
    (handle, engine)
}

/// The engine is gone: only possible while the app quits.
fn stopped() -> Error {
    Error::Network("the sync has stopped".to_string())
}

impl SyncHandle {
    /// A note changed here: sync 2 s after the last change (docs/04).
    pub fn local_change(&self) {
        // `let _ =`: sending only fails once the engine has stopped (the app is quitting).
        let _ = self.requests.send(Request::LocalChange);
    }

    /// The window came back to the front: sync now.
    pub fn focus(&self) {
        let _ = self.requests.send(Request::Focus);
    }

    pub fn status(&self) -> SyncStatus {
        // A poisoned lock still holds a usable status: take it anyway.
        match self.status.lock() {
            Ok(status) => status.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// Syncs now and waits for the end: « Synchroniser maintenant ».
    pub async fn sync_now(&self) -> Result<SyncStatus> {
        let (reply, answer) = oneshot::channel();
        self.requests
            .send(Request::SyncNow(reply))
            .map_err(|_| stopped())?;
        // `.await`: this command waits here, without blocking a thread, until the engine
        // answers.
        answer.await.map_err(|_| stopped())
    }

    pub async fn login(&self, login: Login) -> Result<SyncStatus> {
        let (reply, answer) = oneshot::channel();
        self.requests
            .send(Request::Login(login, reply))
            .map_err(|_| stopped())?;
        answer.await.map_err(|_| stopped())?
    }

    pub async fn logout(&self) -> Result<SyncStatus> {
        let (reply, answer) = oneshot::channel();
        self.requests
            .send(Request::Logout(reply))
            .map_err(|_| stopped())?;
        answer.await.map_err(|_| stopped())
    }
}

/// What one request to the server did.
#[derive(Default)]
struct Round {
    changed: bool,
    conflicts: usize,
    /// Another request must follow at once (more to send, or more to receive).
    again: bool,
}

impl Engine {
    /// Starts the engine on Tauri's tokio runtime. `move`: the task owns the engine.
    pub fn spawn(self, app: AppHandle) {
        tauri::async_runtime::spawn(self.run(app));
    }

    async fn run(mut self, app: AppHandle) {
        if self.status().logged_in {
            self.schedule.start(Instant::now());
        }
        loop {
            // Wait for a message, but no later than the next planned sync.
            let request = match self.schedule.next() {
                Some(at) => {
                    let deadline = tokio::time::Instant::from_std(at);
                    match tokio::time::timeout_at(deadline, self.requests.recv()).await {
                        Ok(request) => request,
                        // The deadline came first: time to sync.
                        Err(_elapsed) => {
                            self.sync(&app).await;
                            continue;
                        }
                    }
                }
                None => self.requests.recv().await,
            };
            // `None`: every handle is gone, the app is quitting.
            let Some(request) = request else {
                return;
            };
            match request {
                Request::LocalChange => self.schedule.local_change(Instant::now()),
                Request::Focus => self.schedule.focus(Instant::now()),
                Request::SyncNow(reply) => {
                    if self.schedule.is_active() {
                        self.sync(&app).await;
                    }
                    let _ = reply.send(self.status());
                }
                Request::Login(login, reply) => {
                    let result = self.login(&app, login).await;
                    let _ = reply.send(result);
                }
                Request::Logout(reply) => {
                    self.logout(&app).await;
                    let _ = reply.send(self.status());
                }
            }
        }
    }

    fn status(&self) -> SyncStatus {
        match self.status.lock() {
            Ok(status) => status.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// Changes the status, then tells the frontend. `change` is a closure that edits it.
    fn set_status(&self, app: &AppHandle, change: impl FnOnce(&mut SyncStatus)) {
        let status = {
            let mut status = match self.status.lock() {
                Ok(status) => status,
                Err(poisoned) => poisoned.into_inner(),
            };
            change(&mut status);
            let sent = status.clone();
            // The conflicts belong to this event only.
            status.conflicts = 0;
            sent
        };
        if let Err(error) = app.emit(SYNC_STATUS, status) {
            eprintln!("could not send {SYNC_STATUS}: {error}");
        }
    }

    /// A whole sync: as many requests as needed (more than 200 notes to send, `has_more`).
    async fn sync(&mut self, app: &AppHandle) {
        self.schedule.attempt(Instant::now());
        self.set_status(app, |status| status.state = SyncState::Syncing);

        let mut conflicts = 0;
        let mut result = Ok(());
        for _ in 0..MAX_ROUNDS {
            match self.round(app).await {
                Ok(round) => {
                    conflicts += round.conflicts;
                    if round.changed {
                        notify_notes_changed(app);
                    }
                    if !round.again {
                        break;
                    }
                }
                Err(error) => {
                    result = Err(error);
                    break;
                }
            }
        }
        self.finish(app, result, conflicts);
    }

    /// The status and the next sync, after a sync.
    fn finish(&mut self, app: &AppHandle, result: Result<()>, conflicts: usize) {
        let now = Instant::now();
        match result {
            Ok(()) => {
                self.schedule.succeeded(now);
                let last_sync_at = app
                    .state::<AppState>()
                    .lock_db()
                    .and_then(|conn| config::load(&conn))
                    .map(|config| config.last_sync_at)
                    .unwrap_or_default();
                self.set_status(app, |status| {
                    status.state = SyncState::Idle;
                    status.error_kind = None;
                    status.message = None;
                    status.last_sync_at = last_sync_at;
                    status.conflicts = conflicts;
                });
            }
            Err(Error::Api { ref code, .. }) if code == "unauthorized" => {
                // The server no longer knows this device (disconnected from another device,
                // or unused for 180 days): log out here too.
                if let Err(error) = app
                    .state::<AppState>()
                    .lock_db()
                    .and_then(|conn| config::forget_token(&conn))
                {
                    eprintln!("could not forget the token: {error}");
                }
                self.schedule.stop();
                self.set_status(app, |status| {
                    status.state = SyncState::Error;
                    status.error_kind = Some("unauthorized".to_string());
                    status.message = None;
                    status.logged_in = false;
                    status.conflicts = conflicts;
                });
            }
            Err(error) => {
                let wait = match &error {
                    Error::Api {
                        retry_after: Some(seconds),
                        ..
                    } => Some(Duration::from_secs(*seconds)),
                    _ => None,
                };
                let delay = self.schedule.failed(now, wait);
                eprintln!("sync failed ({error}), next try in {} s", delay.as_secs());
                let offline = matches!(error, Error::Network(_));
                self.set_status(app, |status| {
                    status.state = if offline {
                        SyncState::Offline
                    } else {
                        SyncState::Error
                    };
                    status.error_kind = Some(error.kind().to_string());
                    status.message = Some(error.to_string());
                    status.conflicts = conflicts;
                });
            }
        }
    }

    /// One request: sends a batch of local changes, applies the answer.
    async fn round(&mut self, app: &AppHandle) -> Result<Round> {
        let state = app.state::<AppState>();

        // 1. What to send. The database is locked for a few milliseconds: the block ends, the
        //    guard is dropped, the lock is released.
        let (config, batch) = {
            let conn = state.lock_db()?;
            (
                config::load(&conn)?,
                apply::collect_changes(&conn, MAX_CHANGES, MAX_CHANGE_BYTES)?,
            )
        };
        let Some((server_url, token)) = config.session() else {
            return Ok(Round::default());
        };

        // 2. The request, without the lock: the commands and the fuse go on meanwhile. Holding
        //    a std `MutexGuard` here would not even compile: it is not `Send`, and a task that
        //    can move between threads at each `.await` may only hold `Send` values.
        let request = SyncRequest {
            cursor: config.cursor,
            changes: &batch.changes,
        };
        let response = self.api.sync(server_url, token, &request).await?;
        self.check_clock(app, response.server_time);

        // 3. The answer, in one transaction.
        let mut conn = state.lock_db()?;
        if response.reset || config.sync_id.as_deref() != Some(response.sync_id.as_str()) {
            // Another history on the server (database recreated or restored): send everything
            // again from the start (docs/04).
            eprintln!("the server's sync history changed: starting over");
            let tx = conn.transaction()?;
            apply::reset(&tx, &response.sync_id)?;
            tx.commit()?;
            return Ok(Round {
                again: true,
                ..Round::default()
            });
        }
        let outcome = apply::apply_response(&mut conn, &batch.changes, &response, now_ms())?;
        Ok(Round {
            changed: outcome.changed,
            conflicts: outcome.conflict_copies,
            again: response.has_more || batch.more,
        })
    }

    /// Fuses rely on the clocks (docs/04): warns when this one is more than 5 minutes off.
    fn check_clock(&self, app: &AppHandle, server_time: i64) {
        let skew = server_time - now_ms();
        let shown = (skew.abs() > CLOCK_SKEW_WARNING_MS).then_some(skew);
        if shown.is_some() {
            eprintln!("this device's clock is {} s off the server's", skew / 1000);
        }
        if self.status().clock_skew_ms != shown {
            self.set_status(app, |status| status.clock_skew_ms = shown);
        }
    }

    async fn login(&mut self, app: &AppHandle, login: Login) -> Result<SyncStatus> {
        let server_url = config::normalize_server_url(&login.server_url)?;
        let email = login.email.trim();
        let device_name: String = match login.device_name.trim() {
            "" => config::default_device_name(),
            name => name.chars().take(DEVICE_NAME_MAX_CHARS).collect(),
        };
        let previous = config::load(&*app.state::<AppState>().lock_db()?)?;
        // Already logged in (another account, another server): that token is given back first.
        if let Some((url, token)) = previous.session() {
            let _ = tokio::time::timeout(LOGOUT_TIMEOUT, self.api.logout(url, token)).await;
        }
        let answer = match &login.invitation_code {
            Some(code) => {
                self.api
                    .register(&server_url, code, email, &login.password, &device_name)
                    .await?
            }
            None => {
                self.api
                    .login(&server_url, email, &login.password, &device_name)
                    .await?
            }
        };

        {
            let state = app.state::<AppState>();
            let mut conn = state.lock_db()?;
            let tx = conn.transaction()?;
            // Another account or another server than last time: every note of this device
            // goes to this account, as if it had never been synced (docs/04). The first
            // login is such a case, with nothing to change: no note was ever synced.
            let known = config::load(&tx)?.sync_id;
            if known.as_deref() != Some(answer.sync_id.as_str()) {
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
            tx.commit()?;
        }

        self.schedule.start(Instant::now());
        self.set_status(app, |status| {
            status.state = SyncState::Idle;
            status.error_kind = None;
            status.message = None;
            status.logged_in = true;
            status.server_url = Some(server_url);
            status.email = Some(answer.email);
            status.device_name = device_name;
        });
        Ok(self.status())
    }

    async fn logout(&mut self, app: &AppHandle) {
        let config = app
            .state::<AppState>()
            .lock_db()
            .and_then(|conn| config::load(&conn))
            .unwrap_or_default();
        // Best effort: offline, the token stays valid on the server until it is disconnected
        // from another device or expires after 180 days unused.
        if let Some((url, token)) = config.session() {
            let _ = tokio::time::timeout(LOGOUT_TIMEOUT, self.api.logout(url, token)).await;
        }
        if let Err(error) = app
            .state::<AppState>()
            .lock_db()
            .and_then(|conn| config::forget_token(&conn))
        {
            eprintln!("could not forget the token: {error}");
        }
        self.schedule.stop();
        self.set_status(app, |status| {
            status.state = SyncState::Idle;
            status.error_kind = None;
            status.message = None;
            status.logged_in = false;
            status.clock_skew_ms = None;
        });
    }
}
