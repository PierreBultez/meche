import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { getSettings, setSettings } from "../api/settings";
import { applyTheme, readSystemTheme, resolveTheme, watchSystemTheme } from "../theme/apply";
import type { ThemePreference } from "../types/settings";

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemePreference>("system");
  const systemTheme = ref(readSystemTheme());
  const resolvedTheme = computed(() => resolveTheme(theme.value, systemTheme.value));

  // Applied as soon as the store exists (before the first render), then on every change.
  watch(resolvedTheme, (value) => applyTheme(value), { immediate: true });
  watchSystemTheme((value) => {
    systemTheme.value = value;
  });

  /** Loads the saved settings from the Rust core. */
  async function load(): Promise<void> {
    const settings = await getSettings();
    theme.value = settings.theme;
  }

  /** Changes the theme at once, then saves it; the change is undone if saving fails. */
  async function setTheme(next: ThemePreference): Promise<void> {
    const previous = theme.value;
    theme.value = next;
    try {
      await setSettings({ theme: next });
    } catch (error) {
      // Only roll back if the user has not picked another theme in the meantime.
      if (theme.value === next) {
        theme.value = previous;
      }
      throw error;
    }
  }

  return { theme, resolvedTheme, load, setTheme };
});
