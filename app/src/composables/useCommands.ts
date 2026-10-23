// Commands shared by the keyboard shortcuts and the command palette (docs/08).
import { useRoute, useRouter } from "vue-router";
import { useNotesStore } from "../stores/notes";
import { useSettingsStore } from "../stores/settings";
import { useToastsStore } from "../stores/toasts";
import { useUiStore } from "../stores/ui";
import type { ListFilter, Note } from "../types/note";
import type { ThemePreference } from "../types/settings";
import { noteRoute, useNoteActions } from "./useNoteActions";

export function useCommands() {
  const notes = useNotesStore();
  const settings = useSettingsStore();
  const toasts = useToastsStore();
  const ui = useUiStore();
  const route = useRoute();
  const router = useRouter();
  const actions = useNoteActions();

  /** The open note, when it can be changed (a note in the trash is read-only). */
  function editableNote(): Note | null {
    const note = notes.current;
    return note !== null && note.trashedAt === null ? note : null;
  }

  /** Opens the note before (-1) or after (+1) the open one in the list. */
  async function openNeighbour(direction: 1 | -1): Promise<void> {
    const id = notes.neighbour(notes.current?.id ?? null, direction);
    if (id !== null && id !== notes.current?.id) await actions.open(id);
  }

  async function togglePin(): Promise<void> {
    const note = editableNote();
    if (note) await actions.togglePin(note);
  }

  /** Ctrl+Maj+E: lights or puts out the fuse of the open note (docs/06). */
  async function toggleFuse(): Promise<void> {
    const note = editableNote();
    if (note) await actions.toggleFuse(note);
  }

  async function trash(): Promise<void> {
    const note = editableNote();
    if (note) await actions.trash(note.id);
  }

  function toggleList(): void {
    if (ui.focusMode) {
      ui.focusMode = false;
      ui.listHidden = false;
    } else {
      ui.listHidden = !ui.listHidden;
    }
  }

  function toggleFocusMode(): void {
    ui.focusMode = !ui.focusMode;
  }

  async function focusSearch(): Promise<void> {
    if (route.name !== "notes") await backToNotes();
    ui.searchFocusRequest++;
  }

  /** Leaves a secondary screen (settings) for the notes, on the note that was open. */
  async function backToNotes(): Promise<void> {
    await router.push(notes.current ? noteRoute(notes.current.id) : "/notes");
  }

  async function showFilter(filter: ListFilter): Promise<void> {
    if (route.name !== "notes") await backToNotes();
    ui.listHidden = false;
    ui.focusMode = false;
    await notes
      .setFilter(filter)
      .catch((error: unknown) => toasts.error("Impossible d'afficher ces notes.", error));
  }

  async function setTheme(theme: ThemePreference): Promise<void> {
    await settings
      .setTheme(theme)
      .catch((error: unknown) => toasts.error("Impossible d'enregistrer le thème.", error));
  }

  async function openSettings(): Promise<void> {
    await router.push("/settings");
  }

  return {
    editableNote,
    openNeighbour,
    togglePin,
    toggleFuse,
    trash,
    toggleList,
    toggleFocusMode,
    focusSearch,
    backToNotes,
    showFilter,
    setTheme,
    openSettings,
    actions,
  };
}
