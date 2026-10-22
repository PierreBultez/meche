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
  trashNote,
  updateNote,
} from "../api/notes";
import type { ListFilter, Note, NoteKind, NotePatch, NoteSummary, SearchResult } from "../types/note";

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

  let listRequest = 0;
  let openRequest = 0;
  let searchRequest = 0;

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
    if (id === null) {
      current.value = null;
      return;
    }
    const note = await getNote(id);
    if (request === openRequest) {
      current.value = note;
    }
  }

  async function create(kind: NoteKind): Promise<Note> {
    const note = await createNote(kind);
    if (filter.value === "trash") {
      filter.value = "all";
    }
    openRequest++;
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
    query,
    results,
    visibleIds,
    refresh,
    setFilter,
    open,
    create,
    save,
    trash,
    restore,
    deleteForever,
    clearTrash,
    search,
    neighbour,
  };
});
