// Typed wrappers around the Rust commands of src-tauri/src/commands/sync.rs. The frontend never
// calls the server itself: Rust does (docs/02, D3).
import { invoke } from "@tauri-apps/api/core";
import type { Device, Invitation, LoginForm, ServerCheck, SyncStatus } from "../types/sync";

export function getSyncStatus(): Promise<SyncStatus> {
  return invoke<SyncStatus>("get_sync_status");
}

export function checkServer(serverUrl: string): Promise<ServerCheck> {
  return invoke<ServerCheck>("check_server", { serverUrl });
}

/** Logs in, or creates an account when the form has an invitation code. */
export function login(form: LoginForm): Promise<SyncStatus> {
  const { serverUrl, email, password, deviceName, invitationCode } = form;
  return invitationCode === undefined
    ? invoke<SyncStatus>("login", { serverUrl, email, password, deviceName })
    : invoke<SyncStatus>("register", { serverUrl, invitationCode, email, password, deviceName });
}

export function logout(): Promise<SyncStatus> {
  return invoke<SyncStatus>("logout");
}

/** Syncs now and waits for the end. */
export function syncNow(): Promise<SyncStatus> {
  return invoke<SyncStatus>("sync_now");
}

export function listDevices(): Promise<Device[]> {
  return invoke<Device[]>("list_devices");
}

export function revokeDevice(id: number): Promise<void> {
  return invoke<void>("revoke_device", { id });
}

export function listInvitations(): Promise<Invitation[]> {
  return invoke<Invitation[]>("list_invitations");
}

export function createInvitation(): Promise<Invitation> {
  return invoke<Invitation>("create_invitation");
}

export function deleteInvitation(id: number): Promise<void> {
  return invoke<void>("delete_invitation", { id });
}
