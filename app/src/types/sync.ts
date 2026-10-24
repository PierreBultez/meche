// Mirrors the Rust types of src-tauri/src/sync/engine.rs, commands/sync.rs and sync/protocol.rs.

export type SyncState = "idle" | "syncing" | "offline" | "error";

/** State of the sync (get_sync_status, `sync-status` event). Dates in ms since 1970 (UTC). */
export interface SyncStatus {
  state: SyncState;
  /** `kind` of the last error (network, unauthorized…): see utils/sync-messages.ts. */
  errorKind: string | null;
  /** Technical detail of the last error, for the console. */
  message: string | null;
  loggedIn: boolean;
  serverUrl: string | null;
  email: string | null;
  deviceName: string;
  lastSyncAt: number | null;
  /** Difference with the server's clock when it is over 5 minutes. */
  clockSkewMs: number | null;
  /** Conflict copies created by the sync that has just ended (only in that event). */
  conflicts: number;
}

/** What « Tester la connexion » found (check_server). */
export interface ServerCheck {
  serverUrl: string;
  serverTime: number;
}

/** A device connected to the account (list_devices). */
export interface Device {
  id: number;
  name: string;
  createdAt: number | null;
  lastUsedAt: number | null;
  current: boolean;
}

/** An invitation code (list_invitations). `code` is only there right after it was created. */
export interface Invitation {
  id: number;
  code: string | null;
  hint: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedByEmail: string | null;
}

export interface LoginForm {
  serverUrl: string;
  email: string;
  password: string;
  deviceName: string;
  /** Present to create an account (invitation given by an existing account). */
  invitationCode?: string;
}

/** Event sent by Rust whenever the state of the sync changes (docs/02). */
export const SYNC_STATUS = "sync-status";
