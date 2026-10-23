import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  createNote,
  deleteNoteForever,
  emptyTrash,
  getNote,
  listNotes,
  restoreNote,
  searchNotes,
  setEphemeral,
  trashNote,
  updateNote,
} from "../api/notes";
import type {
  CommandError,
  ListFilter,
  Note,
  NoteKind,
  NotePatch,
  NoteSummary,
  SearchResult,
} from "../types/note";

/**
 * Notes shown in the interface. Rust owns the data: every action calls a command, then reloads
 * what changed. Answers that arrive after a newer request (fast typing, quick clicks) are dropped.
 */
export const useNotesStore = defineStore("notes", () => {
  const filter = ref<ListFilter>("all");
  const summaries = ref<NoteSummary[]>([]);
  /** The note open in the editor. Editors read its content only when it is opened. */
  const current = ref<Note | null>(null);
  const query = ref("");
  /** Search results, or null when the search box is empty. */
  const results = ref<SearchResult[] | null>(null);

  /**
   * Incremented to mount the editor again on the open note (NotesView's `key`): its text
   * changed on another device and editors read the text only when they are mounted.
   */
  const editorGeneration = ref(0);

  let listRequest = 0;
  let openRequest = 0;
  /** The note asked by the latest open request (it may still be loading), or null. */
  let wantedId: string | null = null;
  let searchRequest = 0;
  /** Counts the `notes-changed` events: an opening that saw one start may have read too early. */
  let changeCount = 0;

  /** Ids in the order they are shown (search results first when searching). */
  const visibleIds = computed(() =>
    (results.value ?? summaries.value).map((item) => item.id),
  );

  async function refresh(): Promise<void> {
    const request = ++listRequest;
    const list = await listNotes(filter.value);
    if (request === listRequest) {
      summaries.value = list;
    }
    if (query.value.trim() !== "") {
      await search(query.value);
    }
  }

  async function setFilter(next: ListFilter): Promise<void> {
    filter.value = next;
    await refresh();
  }

  async function open(id: string | null): Promise<void> {
    const request = ++openRequest;
    wantedId = id;
    if (id === null) {
      current.value = null;
      return;
    }
    let note: Note;
    try {
      const changes = changeCount;
      note = await getNote(id);
      // Notes changed while it was read (the sync): reload() could not refresh a note that was
      // not open yet, so it is read again, to never open an old version.
      if (changes !== changeCount && request === openRequest) note = await getNote(id);
    } catch (error) {
      // Not opened: the note still open is the one wanted (reload() keeps refreshing it).
      if (request === openRequest) wantedId = current.value?.id ?? null;
      throw error;
    }
    if (request === openRequest) {
      current.value = note;
    }
  }

  /**
   * Mounts the editor again on note `id` as it is stored now (docs/04: its text changed on
   * another device while it was open). Returns false when it no longer exists.
   */
  async function reopen(id: string): Promise<boolean> {
    if (current.value?.id !== id) return true;
    const request = openRequest;
    try {
      const note = await getNote(id);
      if (request !== openRequest || current.value?.id !== id) return true;
      current.value = note;
      editorGeneration.value++;
      return true;
    } catch (error) {
      if ((error as CommandError | undefined)?.kind !== "not_found") throw error;
      if (request === openRequest && current.value?.id === id) current.value = null;
      return false;
    }
  }

  /** `fused`: « Nouvelle note à mèche », its fuse is lit at once. */
  async function create(kind: NoteKind, fused = false): Promise<Note> {
    const note = await createNote(kind, fused);
    if (filter.value === "trash") {
      filter.value = "all";
    }
    openRequest++;
    wantedId = note.id;
    current.value = note;
    await refresh();
    return note;
  }

  /** Saves a change and returns the saved note. */
  async function save(id: string, patch: NotePatch): Promise<Note> {
    const note = await updateNote(id, patch);
    if (current.value?.id === id) {
      current.value = note;
    }
    await refresh();
    return note;
  }

  /** Lights or puts out the fuse of a note (docs/06). */
  async function setFuse(id: string, enabled: boolean): Promise<Note> {
    const note = await setEphemeral(id, enabled);
    if (current.value?.id === id) {
      current.value = note;
    }
    await refresh();
    return note;
  }

  /**
   * Rust changed notes on its own (a fuse burnt out, the trash was purged: `notes-changed`).
   * Reloads the list and the open note. Returns false when the open note no longer exists.
   */
  async function reload(): Promise<boolean> {
    changeCount++;
    // Not a new open request: a note opened before or during this reload keeps priority, so
    // its answer is never dropped for the note that was open when the event came.
    const request = openRequest;
    await refresh();
    const id = current.value?.id;
    if (id === undefined) return true;
    // Also false while another note is being opened (asked before the event, still loading):
    // that note must neither be replaced nor lose its page to a redirection.
    const stillWanted = () =>
      request === openRequest && current.value?.id === id && wantedId === id;
    try {
      const note = await getNote(id);
      if (stillWanted()) current.value = note;
      return true;
    } catch (error) {
      if ((error as CommandError | undefined)?.kind !== "not_found") throw error;
      // Another note was opened meanwhile: that one is still there.
      if (!stillWanted()) return true;
      current.value = null;
      return false;
    }
  }

  async function trash(id: string): Promise<void> {
    await trashNote(id);
    if (current.value?.id === id) {
      current.value = null;
    }
    await refresh();
  }

  async function restore(id: string): Promise<void> {
    await restoreNote(id);
    if (current.value?.id === id) {
      await open(id);
    }
    await refresh();
  }

  async function deleteForever(id: string): Promise<void> {
    await deleteNoteForever(id);
    if (current.value?.id === id) {
      current.value = null;
    }
    await refresh();
  }

  async function clearTrash(): Promise<number> {
    const count = await emptyTrash();
    if (current.value !== null && current.value.trashedAt !== null) {
      current.value = null;
    }
    await refresh();
    return count;
  }

  async function search(text: string): Promise<void> {
    query.value = text;
    const request = ++searchRequest;
    if (text.trim() === "") {
      results.value = null;
      return;
    }
    const found = await searchNotes(text);
    if (request === searchRequest) {
      results.value = found;
    }
  }

  /** The note before (-1) or after (+1) `id` in the visible list. */
  function neighbour(id: string | null, direction: 1 | -1): string | null {
    const ids = visibleIds.value;
    if (ids.length === 0) {
      return null;
    }
    const index = id === null ? -1 : ids.indexOf(id);
    if (index === -1) {
      return direction === 1 ? ids[0] : ids[ids.length - 1];
    }
    return ids[Math.min(Math.max(index + direction, 0), ids.length - 1)];
  }

  return {
    filter,
    summaries,
    current,
    editorGeneration,
    query,
    results,
    visibleIds,
    refresh,
    setFilter,
    open,
    reopen,
    create,
    save,
    setFuse,
    reload,
    trash,
    restore,
    deleteForever,
    clearTrash,
    search,
    neighbour,
  };
});
