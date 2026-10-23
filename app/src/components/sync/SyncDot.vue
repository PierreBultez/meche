<script setup lang="ts">
// The sync dot at the bottom of the list (docs/08): green up to date, orange syncing, grey
// offline (or no server), red error; hovering gives the detail. Its own component reading its
// own store: when it changes, the list is not redrawn.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useNow } from "../../composables/useNow";
import { useSyncStore } from "../../stores/sync";
import { useToastsStore } from "../../stores/toasts";
import { agoText } from "../../utils/relative-date";
import { syncErrorMessage, syncStateText } from "../../utils/sync-messages";

/** A sync shorter than this does not turn the dot orange: no blinking every minute. */
const SYNCING_SHOWN_AFTER_MS = 400;

const sync = useSyncStore();
const toasts = useToastsStore();
const router = useRouter();
const now = useNow();

const syncingShown = ref(false);
let syncingTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => sync.status?.state,
  (state) => {
    if (syncingTimer !== null) clearTimeout(syncingTimer);
    syncingTimer = null;
    if (state === "syncing") {
      syncingTimer = setTimeout(() => (syncingShown.value = true), SYNCING_SHOWN_AFTER_MS);
    } else {
      syncingShown.value = false;
    }
  },
);
onBeforeUnmount(() => {
  if (syncingTimer !== null) clearTimeout(syncingTimer);
});

/** The last color before the sync started, kept while a short sync runs. */
const settled = ref<string>("text-muted");
const color = computed(() => {
  const status = sync.status;
  if (!status?.loggedIn) return status?.errorKind === "unauthorized" ? "text-danger" : "text-muted";
  switch (status.state) {
    case "syncing":
      return syncingShown.value ? "text-spark" : settled.value;
    case "offline":
      return "text-muted";
    case "error":
      return "text-danger";
    default:
      return "text-ok";
  }
});
watch(
  color,
  (value) => {
    if (sync.status?.state !== "syncing") settled.value = value;
  },
  { immediate: true },
);

const text = computed(() => {
  const status = sync.status;
  if (status?.state === "syncing" && !syncingShown.value) {
    return syncStateText({ ...status, state: "idle" }, (ms) => agoText(ms, now.value));
  }
  return syncStateText(status, (ms) => agoText(ms, now.value));
});

/** Click: syncs now (or opens the settings when no server is connected). */
async function onClick(): Promise<void> {
  if (!sync.loggedIn) {
    await router.push({ name: "settings", hash: "#server" });
    return;
  }
  try {
    const status = await sync.syncNow();
    if (status.state === "offline" || status.state === "error") {
      toasts.show(syncErrorMessage(status.errorKind), { tone: "error" });
    }
  } catch (error) {
    toasts.error(syncErrorMessage("server"), error);
  }
}
</script>

<template>
  <button
    type="button"
    class="flex items-center rounded-button p-2.5 hover:bg-surface-2"
    :class="color"
    :title="text"
    :aria-label="text"
    data-sync-dot
    @click="onClick"
  >
    <span class="block h-2.5 w-2.5 rounded-full bg-current" aria-hidden="true" />
  </button>
</template>
