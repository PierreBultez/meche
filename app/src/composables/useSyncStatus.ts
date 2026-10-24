// Rust sends `sync-status` whenever the state of the sync changes (docs/02): the store follows
// it, and conflict copies are announced.
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onBeforeUnmount, onMounted } from "vue";
import { useSyncStore } from "../stores/sync";
import { useToastsStore } from "../stores/toasts";
import { SYNC_STATUS, type SyncStatus } from "../types/sync";

/** A `sync-status` event: the store follows it; conflict copies are announced. */
export function onSyncStatus(status: SyncStatus): void {
  useSyncStore().apply(status);
  if (status.conflicts > 0) {
    useToastsStore().show(
      status.conflicts === 1
        ? "Une note a été modifiée ici et sur un autre appareil : ta version est gardée dans une copie « (conflit du …) »."
        : `${status.conflicts} notes ont été modifiées ici et sur un autre appareil : tes versions sont gardées dans des copies « (conflit du …) ».`,
    );
  }
}

export function useSyncStatus(): void {
  const sync = useSyncStore();
  let unlisten: UnlistenFn | null = null;
  let unmounted = false;

  onMounted(async () => {
    if (!isTauri()) return;
    const stop = await listen<SyncStatus>(SYNC_STATUS, (event) => onSyncStatus(event.payload));
    if (unmounted) {
      stop();
      return;
    }
    unlisten = stop;
    // Read after listening: a status sent in between is not missed.
    await sync.load().catch((error: unknown) => console.error("Could not read the sync status", error));
  });
  onBeforeUnmount(() => {
    unmounted = true;
    unlisten?.();
  });
}
