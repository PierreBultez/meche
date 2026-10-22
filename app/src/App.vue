<script setup lang="ts">
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted } from "vue";
import CommandPalette from "./components/CommandPalette.vue";
import ToastStack from "./components/ui/ToastStack.vue";
import { flushAllAutosaves } from "./composables/useAutosave";
import { useGlobalShortcuts } from "./composables/useGlobalShortcuts";

useGlobalShortcuts();

onMounted(() => {
  if (!isTauri()) return;
  // Save what is being typed before the window closes (docs/05). The handler must never throw:
  // the window would then stay open.
  void getCurrentWindow().onCloseRequested(async () => {
    try {
      await flushAllAutosaves();
    } catch (error) {
      console.error("Could not save before closing", error);
    }
  });
});
</script>

<template>
  <RouterView />
  <CommandPalette />
  <ToastStack />
</template>
