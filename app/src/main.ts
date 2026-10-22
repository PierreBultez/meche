import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useSettingsStore } from "./stores/settings";
import "./styles/main.css";

const app = createApp(App).use(createPinia()).use(router);

// Creating the store applies the system theme right away; the saved preference follows
// (a local IPC call, a few milliseconds) before the first render to avoid a theme flash.
const settings = useSettingsStore();
settings
  .load()
  .catch((error: unknown) => console.error("Could not load settings", error))
  .finally(() => app.mount("#app"));
