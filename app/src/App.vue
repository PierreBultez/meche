<script setup lang="ts">
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted } from "vue";
import CommandPalette from "./components/CommandPalette.vue";
import ToastStack from "./components/ui/ToastStack.vue";
import { flushAllAutosaves, saveFailureSeries } from "./composables/useAutosave";
import { useGlobalShortcuts } from "./composables/useGlobalShortcuts";
import { useNotesChanged } from "./composables/useNotesChanged";
import { useSyncStatus } from "./composables/useSyncStatus";
import { useImportStore } from "./stores/import";
import { useToastsStore } from "./stores/toasts";

useGlobalShortcuts();
useNotesChanged();
useSyncStatus();
const toasts = useToastsStore();
/** The window stays open once per series of failed saves, then closes anyway. */
let refusedSeries = -1;

onMounted(() => {
  if (!isTauri()) return;
  // Notes left to triage after an import: the palette offers « Reprendre le tri » (docs/07).
  useImportStore()
    .loadTriage()
    .catch((error: unknown) => console.error("could not read the triage", error));
  // Save what is being typed before the window closes (docs/05). The handler must never throw:
  // the window would then stay open.
  void getCurrentWindow().onCloseRequested(async (event) => {
    try {
      await flushAllAutosaves();
    } catch (error) {
      if (refusedSeries === saveFailureSeries()) return;
      refusedSeries = saveFailureSeries();
      event.preventDefault();
      toasts.error(
        "La note ouverte n'a pas pu être enregistrée. Ferme à nouveau pour quitter quand même.",
        error,
      );
    }
  });
});
</script>

<template>
  <RouterView />
  <CommandPalette />
  <ToastStack />
</template>
