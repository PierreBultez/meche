// Keyboard shortcuts of docs/08 ("Raccourcis desktop").

export type ShortcutAction =
  | "palette"
  | "newNote"
  | "newCodeNote"
  | "search"
  | "togglePin"
  | "trash"
  | "previousNote"
  | "nextNote"
  | "toggleList"
  | "focusMode"
  | "escape";

/** The action of a key press, or null. Ctrl on Linux and Windows, Cmd on macOS. */
export function shortcutFor(event: KeyboardEvent): ShortcutAction | null {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (!mod) {
    return event.key === "Escape" && !event.shiftKey && !event.altKey ? "escape" : null;
  }
  if (event.altKey) return null;
  if (event.shiftKey) {
    if (key === "n") return "newCodeNote";
    if (key === "f") return "focusMode";
    return null;
  }
  switch (key) {
    case "k":
      return "palette";
    case "n":
      return "newNote";
    case "f":
      return "search";
    case "p":
      return "togglePin";
    case "delete":
      return "trash";
    case "arrowup":
      return "previousNote";
    case "arrowdown":
      return "nextNote";
    case "\\":
      return "toggleList";
    default:
      return null;
  }
}
