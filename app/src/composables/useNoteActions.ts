// Actions on notes shared by buttons, keyboard shortcuts and the command palette.
import { useRouter } from "vue-router";
import { useNotesStore } from "../stores/notes";
import { useToastsStore } from "../stores/toasts";
import { useUiStore } from "../stores/ui";
import type { Note, NoteColor, NoteKind } from "../types/note";
import { fuseDelayLabel } from "../utils/fuse";
import { flushAllAutosaves } from "./useAutosave";

export function noteRoute(id: string): string {
  return `/notes/${id}`;
}

export function useNoteActions() {
  const notes = useNotesStore();
  const toasts = useToastsStore();
  const ui = useUiStore();
  const router = useRouter();

  /**
   * Saves what is being typed before leaving the open note. When it cannot be saved, says so and
   * returns false: the action stops and the note stays open, so nothing typed is lost.
   */
  async function saveOpenNote(): Promise<boolean> {
    try {
      await flushAllAutosaves();
      return true;
    } catch (error) {
      toasts.error(
        "La note ouverte n'a pas pu être enregistrée. Elle reste ouverte pour que rien ne soit perdu.",
        error,
      );
      return false;
    }
  }

  /** `fused`: « Nouvelle note à mèche », its fuse is lit with the delay of the settings. */
  async function create(kind: NoteKind, fused = false): Promise<Note | null> {
    if (!(await saveOpenNote())) return null;
    try {
      const note = await notes.create(kind, fused);
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
    if (!(await saveOpenNote())) return;
    try {
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

  /** Lights or puts out the fuse of a note (docs/06), and says so with the delay: the icon
   * alone is easy to miss. */
  async function toggleFuse(note: Note): Promise<void> {
    const lighting = note.ephemeralMode === null;
    try {
      const saved = await notes.setFuse(note.id, lighting);
      const hours = saved.ephemeralDelayHours;
      toasts.show(
        hours !== null
          ? `Mèche allumée : la note explosera dans ${fuseDelayLabel(hours)}.`
          : "Mèche éteinte.",
      );
    } catch (error) {
      toasts.error(
        lighting ? "Impossible d'allumer la mèche." : "Impossible d'éteindre la mèche.",
        error,
      );
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
    if (!(await saveOpenNote())) return;
    try {
      await notes.save(note.id, { kind: note.kind === "rich" ? "code" : "rich" });
    } catch (error) {
      toasts.error("Impossible de convertir la note.", error);
    }
  }

  /** Opens a note from the keyboard (shortcut, palette): typing goes on in its text. */
  async function open(id: string): Promise<void> {
    ui.editorFocusPending = id;
    await router.push(noteRoute(id));
  }

  return { saveOpenNote, create, restore, trash, togglePin, toggleFuse, setColor, convert, open };
}
