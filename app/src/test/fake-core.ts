// In-memory stand-in for the Rust core, for frontend tests (mocks Tauri's invoke).
// It follows the same rules as src-tauri/src/db/notes.rs, in a simplified way.
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Note, NoteKind, NotePatch, NoteSummary, SearchResult } from "../types/note";
import { MATCH_END, MATCH_START } from "../types/note";

export interface FakeCore {
  notes: Note[];
  calls: Array<{ cmd: string; args: Record<string, unknown> }>;
  /** Delay of the fuses lit by set_ephemeral and create_note (the setting, in Rust). */
  fuseDelayHours: number;
  /** Delays the answer of the next call of `cmd` until `release()` is called. */
  hold(cmd: string): { release: () => void };
}

export function installFakeCore(): FakeCore {
  const core: FakeCore = { notes: [], calls: [], fuseDelayHours: 168, hold };
  const held = new Map<string, Promise<void>>();
  let clock = 1_000;
  let counter = 0;

  function hold(cmd: string) {
    let release!: () => void;
    held.set(cmd, new Promise<void>((resolve) => (release = resolve)));
    return { release: () => release() };
  }

  /** Lights a fuse with the delay of the settings (fuseDelayHours, as Rust does). */
  const lightFuse = (note: Note): void => {
    const hours = core.fuseDelayHours;
    Object.assign(note, {
      ephemeralMode: "delay",
      ephemeralDelayHours: hours,
      ephemeralStartedAt: ++clock,
      destroyAt: clock + hours * 3_600_000,
      updatedAt: clock,
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
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
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
      if (fused) lightFuse(note);
      core.notes.push(note);
      return { ...note };
    },
    update_note: ({ id, patch }) => {
      const note = find(id as string);
      Object.assign(note, patch as NotePatch, { updatedAt: ++clock });
      return { ...note };
    },
    set_ephemeral: ({ id, enabled }) => {
      const note = find(id as string);
      if (note.trashedAt !== null) throw { kind: "invalid_input", message: "in the trash" };
      if (enabled && note.ephemeralMode === null) lightFuse(note);
      if (!enabled && note.ephemeralMode !== null) {
        Object.assign(note, {
          ephemeralMode: null,
          ephemeralDelayHours: null,
          ephemeralStartedAt: null,
          destroyAt: null,
          updatedAt: ++clock,
        });
      }
      return { ...note };
    },
    trash_note: ({ id }) => {
      Object.assign(find(id as string), { trashedAt: ++clock, trashReason: "manual" });
    },
    restore_note: ({ id }) => {
      Object.assign(find(id as string), { trashedAt: null, trashReason: null });
    },
    delete_note_forever: ({ id }) => {
      core.notes = core.notes.filter((note) => note.id !== id);
    },
    empty_trash: () => {
      const before = core.notes.length;
      core.notes = core.notes.filter((note) => note.trashedAt === null);
      return before - core.notes.length;
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
    const handler = commands[cmd];
    if (!handler) throw new Error(`fake core: unknown command ${cmd}`);
    return handler(payload);
  });
  return core;
}
