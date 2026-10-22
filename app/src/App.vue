<script setup lang="ts">
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted } from "vue";
import CommandPalette from "./components/CommandPalette.vue";
import ToastStack from "./components/ui/ToastStack.vue";
import { flushAllAutosaves } from "./composables/useAutosave";
import { useGlobalShortcuts } from "./composables/useGlobalShortcuts";
import { useToastsStore } from "./stores/toasts";

useGlobalShortcuts();
const toasts = useToastsStore();
/** The window stays open once if the open note could not be saved, then closes anyway. */
let closeRefused = false;

onMounted(() => {
  if (!isTauri()) return;
  // Save what is being typed before the window closes (docs/05). The handler must never throw:
  // the window would then stay open.
  void getCurrentWindow().onCloseRequested(async (event) => {
    try {
      await flushAllAutosaves();
    } catch (error) {
      if (closeRefused) return;
      closeRefused = true;
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
