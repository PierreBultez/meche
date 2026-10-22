import { defineStore } from "pinia";
import { ref } from "vue";

/** Interface state that is not saved: hidden list, focus mode, open command palette. */
export const useUiStore = defineStore("ui", () => {
  /** Ctrl+\ hides the note list (docs/08). */
  const listHidden = ref(false);
  /** Ctrl+Shift+F hides the list and the note header (docs/08). */
  const focusMode = ref(false);
  const paletteOpen = ref(false);
  /** Incremented to ask the list to focus its search box (Ctrl+F). */
  const searchFocusRequest = ref(0);
  /** Incremented to ask the list to focus the open note's card (Échap from the editor). */
  const listFocusRequest = ref(0);
  /** Set when a note is opened from the keyboard: its text gets the focus once it is ready. */
  const editorFocusPending = ref(false);

  /** Échap in the open note (docs/08): leaves the focus mode, otherwise back to the list. */
  function escapeFromNote(): void {
    if (focusMode.value) focusMode.value = false;
    else listFocusRequest.value++;
  }

  return {
    listHidden,
    focusMode,
    paletteOpen,
    searchFocusRequest,
    listFocusRequest,
    editorFocusPending,
    escapeFromNote,
  };
});
