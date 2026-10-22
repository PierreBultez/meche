import { createApp } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useSettingsStore } from "./stores/settings";
import "./styles/main.css";

const app = createApp(App).use(createPinia()).use(router);

/** Paints the native window with the theme's background, then shows it (it starts hidden). */
async function showWindow(): Promise<void> {
  const appWindow = getCurrentWindow();
  const background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  await appWindow
    .setBackgroundColor(background)
    .catch((error: unknown) => console.error("Could not set the window background", error));
  await appWindow.show();
}

// The window starts hidden (tauri.conf.json) so it never flashes in the wrong theme.
// Creating the store applies the system theme; the saved preference follows (a local IPC call),
// then the app is mounted and only then is the window shown.
const settings = useSettingsStore();
settings
  .load()
  .catch((error: unknown) => console.error("Could not load settings", error))
  .finally(() => {
    app.mount("#app");
    showWindow().catch((error: unknown) => console.error("Could not show the window", error));
  });
