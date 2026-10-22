<script setup lang="ts">
import { useSettingsStore } from "../stores/settings";
import type { ThemePreference } from "../types/settings";

const settings = useSettingsStore();

const options: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
  { value: "system", label: "Système" },
];

function choose(value: ThemePreference) {
  settings
    .setTheme(value)
    .catch((error: unknown) => console.error("Could not save the theme", error));
}
</script>

<template>
  <div role="group" aria-label="Thème" class="inline-flex gap-1 rounded-button bg-surface-2 p-1">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :aria-pressed="settings.theme === option.value"
      class="rounded-button px-3 py-1.5 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none"
      :class="
        settings.theme === option.value ? 'bg-brand text-on-brand' : 'text-muted hover:text-text'
      "
      @click="choose(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
