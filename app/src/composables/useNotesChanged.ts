// Rust changes notes on its own: a fuse burns out, the trash is purged (docs/06). It then sends
// the `notes-changed` event (docs/02), and the list and the open note are reloaded here.
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onBeforeUnmount, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useNotesStore } from "../stores/notes";
import { useToastsStore } from "../stores/toasts";

export const NOTES_CHANGED = "notes-changed";

export function useNotesChanged(): void {
  const notes = useNotesStore();
  const toasts = useToastsStore();
  const route = useRoute();
  const router = useRouter();
  let unlisten: UnlistenFn | null = null;
  let unmounted = false;

  /** A note that exploded stays open, read-only, with the trash banner. Only a note deleted for
   * good (the trash purge) is closed. */
  async function onNotesChanged(): Promise<void> {
    try {
      const stillThere = await notes.reload();
      if (!stillThere && route.name === "notes" && route.params.noteId) {
        await router.replace("/notes");
      }
    } catch (error) {
      toasts.error("Impossible de recharger les notes.", error);
    }
  }

  onMounted(async () => {
    if (!isTauri()) return;
    const stop = await listen(NOTES_CHANGED, () => void onNotesChanged());
    // Unmounted while `listen` was answering: stop at once.
    if (unmounted) stop();
    else unlisten = stop;
  });
  onBeforeUnmount(() => {
    unmounted = true;
    unlisten?.();
  });
}
