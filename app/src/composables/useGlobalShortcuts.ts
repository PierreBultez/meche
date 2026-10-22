// Keyboard shortcuts of docs/08, listened to on the whole window.
import { onBeforeUnmount, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useUiStore } from "../stores/ui";
import { type ShortcutAction, shortcutFor } from "../utils/shortcuts";
import { useCommands } from "./useCommands";

/** Shortcuts that act on the open note or the list: only on the notes screen. */
const NOTES_SCREEN_ONLY: ShortcutAction[] = ["togglePin", "trash", "previousNote", "nextNote"];
/** Shortcuts that may repeat while the keys are held down. */
const REPEATABLE: ShortcutAction[] = ["previousNote", "nextNote"];

const closest = (target: EventTarget | null, selector: string): Element | null =>
  target instanceof Element ? target.closest(selector) : null;

export function useGlobalShortcuts(): void {
  const ui = useUiStore();
  const route = useRoute();
  const commands = useCommands();

  async function run(action: ShortcutAction): Promise<void> {
    switch (action) {
      case "palette":
        ui.paletteOpen = !ui.paletteOpen;
        break;
      case "newNote":
        await commands.actions.create("rich");
        break;
      case "newCodeNote":
        await commands.actions.create("code");
        break;
      case "search":
        await commands.focusSearch();
        break;
      case "togglePin":
        await commands.togglePin();
        break;
      case "trash":
        await commands.trash();
        break;
      case "previousNote":
        await commands.openNeighbour(-1);
        break;
      case "nextNote":
        await commands.openNeighbour(1);
        break;
      case "toggleList":
        commands.toggleList();
        break;
      case "focusMode":
        commands.toggleFocusMode();
        break;
      case "escape":
        break;
    }
  }

  // Ctrl shortcuts are caught before the editors see them (capture phase): TipTap, CodeMirror
  // and text fields would otherwise use some of them (Ctrl+Suppr deletes a word, Ctrl+↑ moves
  // the cursor).
  function onKeyDownCapture(event: KeyboardEvent): void {
    const action = shortcutFor(event);
    if (action === null || action === "escape") return;
    // A confirmation dialog is open: only its buttons count. The palette is a dialog too, but
    // its shortcuts keep working (Ctrl+K closes it).
    if (closest(event.target, "dialog") && !closest(event.target, "[data-command-palette]")) return;
    // In a code note, Ctrl+F opens CodeMirror's search inside the note (docs/08).
    if (action === "search" && closest(event.target, ".cm-editor")) return;
    if (NOTES_SCREEN_ONLY.includes(action) && route.name !== "notes") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat && !REPEATABLE.includes(action)) return;
    if (action !== "palette") ui.paletteOpen = false;
    void run(action);
  }

  // Échap is handled last (bubble phase): menus, CodeMirror's search panel and dialogs close
  // themselves first and mark the event as handled. The rich editor always marks it: it calls
  // ui.escapeFromNote() itself.
  function onKeyDown(event: KeyboardEvent): void {
    if (shortcutFor(event) !== "escape" || event.defaultPrevented) return;
    if (closest(event.target, "dialog")) return;
    if (ui.focusMode || closest(event.target, "[data-note-pane]")) {
      ui.escapeFromNote();
    } else if (route.name === "settings") {
      void commands.backToNotes();
    } else {
      return;
    }
    event.preventDefault();
  }

  onMounted(() => {
    window.addEventListener("keydown", onKeyDownCapture, true);
    window.addEventListener("keydown", onKeyDown);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeyDownCapture, true);
    window.removeEventListener("keydown", onKeyDown);
  });
}
