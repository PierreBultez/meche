// In-memory stand-in for the Rust core, for frontend tests (mocks Tauri's invoke).
// It follows the same rules as src-tauri/src/db/notes.rs, in a simplified way.
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Note, NoteKind, NotePatch, NoteSummary, SearchResult } from "../types/note";
import { MATCH_END, MATCH_START } from "../types/note";
import type { Device, Invitation, SyncStatus } from "../types/sync";

export interface FakeCore {
  notes: Note[];
  calls: Array<{ cmd: string; args: Record<string, unknown> }>;
  /** State of the sync returned by the sync commands. */
  sync: SyncStatus;
  devices: Device[];
  invitations: Invitation[];
  /** Makes the next call of `cmd` fail with this error (e.g. `{ kind: "invalid_credentials" }`). */
  fail(cmd: string, error: { kind: string; message?: string }): void;
  /** Delay of the fuses lit by set_ephemeral and create_note (the setting, in Rust). */
  fuseDelayHours: number;
  /** Delays the answer of the next call of `cmd` until `release()` is called. */
  hold(cmd: string): { release: () => void };
}

export function installFakeCore(): FakeCore {
  const core: FakeCore = {
    notes: [],
    calls: [],
    fuseDelayHours: 168,
    hold,
    fail,
    sync: {
      state: "idle",
      errorKind: null,
      message: null,
      loggedIn: false,
      serverUrl: null,
      email: null,
      deviceName: "PC de test",
      lastSyncAt: null,
      clockSkewMs: null,
      conflicts: 0,
    },
    devices: [],
    invitations: [],
  };
  const held = new Map<string, Promise<void>>();
  const failures = new Map<string, { kind: string; message?: string }>();

  function fail(cmd: string, error: { kind: string; message?: string }) {
    failures.set(cmd, error);
  }
  let clock = 1_000;
  let counter = 0;

  function hold(cmd: string) {
    let release!: () => void;
    held.set(cmd, new Promise<void>((resolve) => (release = resolve)));
    return { release: () => release() };
  }

  /** Lights a fuse at `now` with the delay of the settings (fuseDelayHours, as Rust does). */
  const lightFuse = (note: Note, now: number): void => {
    const hours = core.fuseDelayHours;
    Object.assign(note, {
      ephemeralMode: "delay",
      ephemeralDelayHours: hours,
      ephemeralStartedAt: now,
      destroyAt: now + hours * 3_600_000,
      updatedAt: now,
    });
  };

  /** Puts a fuse out (set_ephemeral, and restore_note in the cases where Rust does it). */
  const putFuseOut = (note: Note): void => {
    Object.assign(note, {
      ephemeralMode: null,
      ephemeralDelayHours: null,
      ephemeralStartedAt: null,
      destroyAt: null,
    });
  };

  const find = (id: string): Note => {
    const note = core.notes.find((candidate) => candidate.id === id);
    if (!note) throw { kind: "not_found", message: `note not found: ${id}` };
    return note;
  };

  const summary = (note: Note): NoteSummary => ({
    id: note.id,
    title: note.title || note.content.split("\n")[0] || "",
    preview: note.title ? note.content.split("\n")[0] : (note.content.split("\n")[1] ?? ""),
    kind: note.kind,
    codeLanguage: note.codeLanguage,
    pinned: note.pinned,
    color: note.color,
    ephemeralMode: note.ephemeralMode,
    destroyAt: note.destroyAt,
    trashedAt: note.trashedAt,
    updatedAt: note.updatedAt,
  });

  const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
    list_notes: ({ filter }) =>
      core.notes
        .filter((note) => (filter === "trash" ? note.trashedAt !== null : note.trashedAt === null))
        .filter((note) => filter !== "pinned" || note.pinned)
        .filter((note) => filter !== "ephemeral" || note.ephemeralMode !== null)
        // Same orders as Rust (db::notes::list).
        .sort((a, b) =>
          filter === "trash"
            ? (b.trashedAt ?? 0) - (a.trashedAt ?? 0)
            : filter === "ephemeral"
              ? (a.destroyAt ?? Infinity) - (b.destroyAt ?? Infinity) || b.updatedAt - a.updatedAt
              : Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
        )
        .map(summary),
    get_note: ({ id }) => ({ ...find(id as string) }),
    create_note: ({ kind, fused }) => {
      const note: Note = {
        id: `note-${++counter}`,
        title: "",
        content: "",
        kind: kind as NoteKind,
        codeLanguage: kind === "code" ? "plaintext" : null,
        pinned: false,
        color: "violet",
        ephemeralMode: null,
        ephemeralDelayHours: null,
        ephemeralStartedAt: null,
        destroyAt: null,
        trashedAt: null,
        trashReason: null,
        createdAt: ++clock,
        updatedAt: clock,
      };
      if (fused) lightFuse(note, note.createdAt);
      core.notes.push(note);
      return { ...note };
    },
    update_note: ({ id, patch }) => {
      const note = find(id as string);
      const { expectedTitle, expectedContent, ...change } = patch as NotePatch;
      // Like Rust (db::notes::update): a note changed elsewhere is not overwritten, what was
      // typed goes to a conflict copy.
      const changedElsewhere =
        (expectedTitle !== undefined && expectedTitle !== note.title) ||
        (expectedContent !== undefined && expectedContent !== note.content);
      const updated = { ...note, ...change };
      const same = updated.title === note.title && updated.content === note.content &&
        updated.pinned === note.pinned && updated.color === note.color &&
        updated.kind === note.kind && updated.codeLanguage === note.codeLanguage;
      if (same) return { ...note };
      if (changedElsewhere) {
        // The copy holds the editor's whole version: a field not sent is the one expected.
        const mine = {
          ...updated,
          title: change.title ?? expectedTitle ?? updated.title,
          content: change.content ?? expectedContent ?? updated.content,
        };
        core.notes.push({ ...mine, id: `note-${++counter}`, title: `${mine.title} (conflit du 22/10 14:05)` });
        return { ...note };
      }
      Object.assign(note, change, { updatedAt: ++clock });
      return { ...note };
    },
    set_ephemeral: ({ id, enabled }) => {
      const note = find(id as string);
      // Like Rust, a burnt fuse explodes first (ephemeral::maintenance_before_action).
      if (note.trashedAt === null && note.destroyAt !== null && note.destroyAt <= clock) {
        Object.assign(note, { trashedAt: note.destroyAt, trashReason: "self_destruct" });
        return { ...note };
      }
      if (note.trashedAt !== null) throw { kind: "invalid_input", message: "in the trash" };
      if (enabled && note.ephemeralMode === null) lightFuse(note, ++clock);
      if (!enabled && note.ephemeralMode !== null) {
        putFuseOut(note);
        note.updatedAt = ++clock;
      }
      return { ...note };
    },
    trash_note: ({ id }) => {
      Object.assign(find(id as string), { trashedAt: ++clock, trashReason: "manual" });
    },
    restore_note: ({ id }) => {
      const note = find(id as string);
      const now = ++clock;
      // Same rule as Rust: a note that exploded, or whose fuse burnt out in the trash, comes
      // back with its fuse out.
      if (note.trashReason === "self_destruct" || (note.destroyAt !== null && note.destroyAt <= now)) {
        putFuseOut(note);
      }
      Object.assign(note, { trashedAt: null, trashReason: null, updatedAt: now });
    },
    delete_note_forever: ({ id }) => {
      core.notes = core.notes.filter((note) => note.id !== id);
    },
    empty_trash: () => {
      const before = core.notes.length;
      core.notes = core.notes.filter((note) => note.trashedAt === null);
      return before - core.notes.length;
    },
    set_settings: ({ patch }) => patch,
    get_sync_status: () => ({ ...core.sync }),
    check_server: ({ serverUrl }) => ({ serverUrl, serverTime: clock }),
    login: ({ serverUrl, email, deviceName }) => {
      Object.assign(core.sync, { loggedIn: true, serverUrl, email, deviceName, errorKind: null });
      return { ...core.sync };
    },
    register: ({ serverUrl, email, deviceName }) => {
      Object.assign(core.sync, { loggedIn: true, serverUrl, email, deviceName, errorKind: null });
      return { ...core.sync };
    },
    logout: () => {
      core.sync.loggedIn = false;
      return { ...core.sync };
    },
    sync_now: () => {
      core.sync.lastSyncAt = ++clock;
      return { ...core.sync };
    },
    list_devices: () => core.devices.map((device) => ({ ...device })),
    revoke_device: ({ id }) => {
      core.devices = core.devices.filter((device) => device.id !== id);
    },
    list_invitations: () => core.invitations.map((invitation) => ({ ...invitation, code: null })),
    create_invitation: () => {
      const invitation: Invitation = {
        id: core.invitations.length + 1,
        code: "7KQ2-M9XD-4TPH",
        hint: "4TPH",
        createdAt: clock,
        expiresAt: clock + 7 * 86_400_000,
        usedAt: null,
        usedByEmail: null,
      };
      core.invitations.push(invitation);
      return { ...invitation };
    },
    delete_invitation: ({ id }) => {
      core.invitations = core.invitations.filter((invitation) => invitation.id !== id);
    },
    search: ({ query }): SearchResult[] => {
      const word = String(query).trim().toLowerCase();
      return core.notes
        .filter((note) => note.trashedAt === null && note.content.toLowerCase().includes(word))
        .map((note) => ({
          id: note.id,
          title: note.title,
          excerpt: note.content.replace(new RegExp(word, "i"), (match) => MATCH_START + match + MATCH_END),
          kind: note.kind,
          color: note.color,
          pinned: note.pinned,
          updatedAt: note.updatedAt,
          destroyAt: note.destroyAt,
        }));
    },
  };

  mockIPC(async (cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    core.calls.push({ cmd, args: payload });
    const waiting = held.get(cmd);
    if (waiting) {
      held.delete(cmd);
      await waiting;
    }
    const failure = failures.get(cmd);
    if (failure) {
      failures.delete(cmd);
      throw { message: "", ...failure };
    }
    const handler = commands[cmd];
    if (!handler) throw new Error(`fake core: unknown command ${cmd}`);
    return handler(payload);
  });
  return core;
}
