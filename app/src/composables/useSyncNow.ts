import { useSyncStore } from "../stores/sync";
import { useToastsStore } from "../stores/toasts";
import { syncErrorMessage } from "../utils/sync-messages";

/**
 * « Synchroniser maintenant » (docs/08), from the settings, the palette or the sync dot: waits
 * for the end of the sync and says how it went. `quiet`: nothing is said when it went well
 * (the dot turning green says it).
 */
export function useSyncNow(): (options?: { quiet?: boolean }) => Promise<void> {
  const sync = useSyncStore();
  const toasts = useToastsStore();
  return async ({ quiet = false } = {}) => {
    try {
      const status = await sync.syncNow();
      if (status.state === "offline" || status.state === "error") {
        toasts.show(syncErrorMessage(status.errorKind), { tone: "error" });
      } else if (!quiet) {
        toasts.show("Notes synchronisées.");
      }
    } catch (error) {
      toasts.error(syncErrorMessage("server"), error);
    }
  };
}
