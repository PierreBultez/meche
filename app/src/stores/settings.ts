import { defineStore } from "pinia";
import { computed, ref, type Ref, watch } from "vue";
import { getSettings, setSettings } from "../api/settings";
import {
  applyTheme,
  readSystemTheme,
  resolveTheme,
  syncWindowBackground,
  watchSystemTheme,
} from "../theme/apply";
import type { SettingsPatch, ThemePreference } from "../types/settings";

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemePreference>("system");
  const listWidth = ref(280);
  const codeLineWrap = ref(false);
  const fuseDelayHours = ref(168);
  const systemTheme = ref(readSystemTheme());
  const resolvedTheme = computed(() => resolveTheme(theme.value, systemTheme.value));

  // Applied as soon as the store exists (before the first render), then on every change.
  watch(
    resolvedTheme,
    (value) => {
      applyTheme(value);
      syncWindowBackground().catch((error: unknown) =>
        console.error("Could not set the window background", error),
      );
    },
    { immediate: true },
  );
  watchSystemTheme((value) => {
    systemTheme.value = value;
  });

  /** Loads the saved settings from the Rust core. */
  async function load(): Promise<void> {
    const settings = await getSettings();
    theme.value = settings.theme;
    listWidth.value = settings.listWidth;
    codeLineWrap.value = settings.codeLineWrap;
    fuseDelayHours.value = settings.fuseDelayHours;
  }

  /** Applies a setting at once, then saves it; the change is undone if saving fails. */
  async function change<T>(setting: Ref<T>, next: T, patch: SettingsPatch): Promise<void> {
    const previous = setting.value;
    setting.value = next;
    try {
      await setSettings(patch);
    } catch (error) {
      // Only roll back if the user has not changed it again in the meantime.
      if (setting.value === next) {
        setting.value = previous;
      }
      throw error;
    }
  }

  const setTheme = (next: ThemePreference) => change(theme, next, { theme: next });
  const setListWidth = (next: number) => change(listWidth, next, { listWidth: next });
  const setCodeLineWrap = (next: boolean) =>
    change(codeLineWrap, next, { codeLineWrap: next });
  const setFuseDelayHours = (next: number) =>
    change(fuseDelayHours, next, { fuseDelayHours: next });

  return {
    theme,
    resolvedTheme,
    listWidth,
    codeLineWrap,
    fuseDelayHours,
    load,
    setTheme,
    setListWidth,
    setCodeLineWrap,
    setFuseDelayHours,
  };
});
