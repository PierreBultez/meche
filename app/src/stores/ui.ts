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

  return { listHidden, focusMode, paletteOpen, searchFocusRequest };
});
