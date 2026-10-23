//! Sync commands (docs/02): account, « Synchroniser maintenant », devices, invitations.
//! The sync itself runs in the engine (sync/engine.rs); these commands talk to it.

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::error::{Error, Result};
use crate::sync::config;
use crate::sync::engine::SyncStatus;
use crate::sync::protocol::{Device, Invitation};
use crate::sync::session::Login;

#[tauri::command]
pub async fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus> {
    Ok(state.sync.status())
}

/// What « Tester la connexion » found at an address.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCheck {
    /// The address as it will be used (https:// added, /api removed).
    pub server_url: String,
    pub server_time: i64,
}

/// « Tester la connexion »: is there a Mèche server at this address? (`GET /api/health`)
#[tauri::command]
pub async fn check_server(state: State<'_, AppState>, server_url: String) -> Result<ServerCheck> {
    let server_url = config::normalize_server_url(&server_url)?;
    let health = state.sync.api.health(&server_url).await?;
    Ok(ServerCheck {
        server_url,
        server_time: health.server_time,
    })
}

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    server_url: String,
    email: String,
    password: String,
    device_name: String,
) -> Result<SyncStatus> {
    state
        .sync
        .login(Login {
            server_url,
            email,
            password,
            device_name,
            invitation_code: None,
        })
        .await
}

/// Creates an account with an invitation code given by an existing account, then logs in.
#[tauri::command]
pub async fn register(
    state: State<'_, AppState>,
    server_url: String,
    invitation_code: String,
    email: String,
    password: String,
    device_name: String,
) -> Result<SyncStatus> {
    state
        .sync
        .login(Login {
            server_url,
            email,
            password,
            device_name,
            invitation_code: Some(invitation_code),
        })
        .await
}

/// Logs this device out. Its notes stay on it.
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<SyncStatus> {
    state.sync.logout().await
}

/// « Synchroniser maintenant »: waits for the end of the sync and returns its status.
#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<SyncStatus> {
    state.sync.sync_now().await
}

/// The server and this device's token. The database lock is released when this returns, before
/// the caller waits for the network.
fn session(state: &AppState) -> Result<(String, String)> {
    let config = config::load(&*state.lock_db()?)?;
    match config.session() {
        Some((url, token)) => Ok((url.to_string(), token.to_string())),
        None => Err(Error::InvalidInput(
            "this device is not connected to a server".to_string(),
        )),
    }
}

#[tauri::command]
pub async fn list_devices(state: State<'_, AppState>) -> Result<Vec<Device>> {
    let (url, token) = session(&state)?;
    state.sync.api.devices(&url, &token).await
}

/// Disconnects another device of the account (a lost phone).
#[tauri::command]
pub async fn revoke_device(state: State<'_, AppState>, id: i64) -> Result<()> {
    let (url, token) = session(&state)?;
    state.sync.api.revoke_device(&url, &token, id).await
}

#[tauri::command]
pub async fn list_invitations(state: State<'_, AppState>) -> Result<Vec<Invitation>> {
    let (url, token) = session(&state)?;
    state.sync.api.invitations(&url, &token).await
}

/// A new invitation code, shown once.
#[tauri::command]
pub async fn create_invitation(state: State<'_, AppState>) -> Result<Invitation> {
    let (url, token) = session(&state)?;
    state.sync.api.create_invitation(&url, &token).await
}

#[tauri::command]
pub async fn delete_invitation(state: State<'_, AppState>, id: i64) -> Result<()> {
    let (url, token) = session(&state)?;
    state.sync.api.delete_invitation(&url, &token, id).await
}
