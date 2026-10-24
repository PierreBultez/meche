import { createApp } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useSettingsStore } from "./stores/settings";
import { useSyncStore } from "./stores/sync";
import { syncWindowBackground } from "./theme/apply";
// JetBrains Mono for code (docs/11), bundled with the app: never downloaded from the network.
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "./styles/main.css";

const app = createApp(App).use(createPinia()).use(router);

/** Shows the window (it starts hidden), after making sure its native background matches the theme. */
async function showWindow(): Promise<void> {
  await syncWindowBackground().catch((error: unknown) =>
    console.error("Could not set the window background", error),
  );
  await getCurrentWindow().show();
}

/** First launch (docs/08): no server connected and the question never answered. */
async function showWelcomeIfNeeded(): Promise<void> {
  const sync = useSyncStore();
  await sync.load();
  if (!sync.loggedIn && !settings.welcomeDone) await router.replace("/welcome");
}

// The window starts hidden (tauri.conf.json) so it never flashes in the wrong theme.
// Creating the store applies the system theme; the saved preference follows (a local IPC call),
// then the app is mounted and only then is the window shown.
const settings = useSettingsStore();
settings
  .load()
  .then(showWelcomeIfNeeded)
  .catch((error: unknown) => console.error("Could not load settings", error))
  .finally(() => {
    app.mount("#app");
    showWindow().catch((error: unknown) => console.error("Could not show the window", error));
  });
