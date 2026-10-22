// Actions on notes shared by buttons, keyboard shortcuts and the command palette.
import { useRouter } from "vue-router";
import { useNotesStore } from "../stores/notes";
import { useToastsStore } from "../stores/toasts";
import type { Note, NoteColor, NoteKind } from "../types/note";
import { flushAllAutosaves } from "./useAutosave";

export function noteRoute(id: string): string {
  return `/notes/${id}`;
}

export function useNoteActions() {
  const notes = useNotesStore();
  const toasts = useToastsStore();
  const router = useRouter();

  async function create(kind: NoteKind): Promise<Note | null> {
    try {
      await flushAllAutosaves();
      const note = await notes.create(kind);
      await notes.search("");
      await router.push(noteRoute(note.id));
      return note;
    } catch (error) {
      toasts.error("Impossible de créer la note.", error);
      return null;
    }
  }

  async function restore(id: string, reopen = false): Promise<void> {
    try {
      await notes.restore(id);
      if (reopen) await router.push(noteRoute(id));
    } catch (error) {
      toasts.error("Impossible de restaurer la note.", error);
    }
  }

  /** Moves a note to the trash, with « Annuler » in the message (docs/08). */
  async function trash(id: string): Promise<void> {
    try {
      await flushAllAutosaves();
      await notes.trash(id);
      await router.push("/notes");
      toasts.show("Note mise à la corbeille.", {
        tone: "info",
        action: { label: "Annuler", run: () => restore(id, true) },
      });
    } catch (error) {
      toasts.error("Impossible de mettre la note à la corbeille.", error);
    }
  }

  async function togglePin(note: Note): Promise<void> {
    try {
      await notes.save(note.id, { pinned: !note.pinned });
    } catch (error) {
      toasts.error("Impossible d'épingler la note.", error);
    }
  }

  async function setColor(note: Note, color: NoteColor): Promise<void> {
    try {
      await notes.save(note.id, { color });
    } catch (error) {
      toasts.error("Impossible de changer la couleur.", error);
    }
  }

  /** Rich ↔ code (docs/05). Saves the editor first: Rust converts the stored content. */
  async function convert(note: Note): Promise<void> {
    try {
      await flushAllAutosaves();
      await notes.save(note.id, { kind: note.kind === "rich" ? "code" : "rich" });
    } catch (error) {
      toasts.error("Impossible de convertir la note.", error);
    }
  }

  async function open(id: string): Promise<void> {
    await router.push(noteRoute(id));
  }

  return { create, restore, trash, togglePin, setColor, convert, open };
}
