import { clearMocks } from "@tauri-apps/api/mocks";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { useSyncStore } from "../../stores/sync";
import { useToastsStore } from "../../stores/toasts";
import { type FakeCore, installFakeCore } from "../../test/fake-core";
import type { SyncStatus } from "../../types/sync";
import SyncDot from "./SyncDot.vue";

function status(change: Partial<SyncStatus>): SyncStatus {
  return {
    state: "idle",
    errorKind: null,
    message: null,
    loggedIn: true,
    serverUrl: "https://meche.example",
    email: "p@example.com",
    deviceName: "PC",
    lastSyncAt: null,
    clockSkewMs: null,
    conflicts: 0,
    ...change,
  };
}

async function mountDot() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => null } },
      { path: "/settings", name: "settings", component: { render: () => null } },
    ],
  });
  await router.push("/");
  const wrapper = mount(SyncDot, { global: { plugins: [pinia, router] } });
  return { wrapper, router, sync: useSyncStore() };
}

enableAutoUnmount(afterEach);

describe("sync dot (docs/08)", () => {
  let core: FakeCore;

  beforeEach(() => {
    core = installFakeCore();
  });
  afterEach(() => {
    clearMocks();
    vi.useRealTimers();
  });

  it("is green when up to date, grey offline, red on error, muted without server", async () => {
    const { wrapper, sync } = await mountDot();
    const button = () => wrapper.find("button");

    sync.apply(status({ state: "idle", lastSyncAt: Date.now() }));
    await flushPromises();
    expect(button().classes()).toContain("text-ok");
    expect(button().attributes("title")).toBe("À jour (dernière synchro à l'instant).");
    // The label says what a click does, then the state.
    expect(button().attributes("aria-label")).toBe(
      "Synchroniser maintenant. À jour (dernière synchro à l'instant).",
    );

    sync.apply(status({ state: "offline", errorKind: "network" }));
    await flushPromises();
    expect(button().classes()).toContain("text-muted");
    expect(button().attributes("title")).toBe("Serveur injoignable. La synchro reprendra toute seule.");

    sync.apply(status({ state: "error", errorKind: "server" }));
    await flushPromises();
    expect(button().classes()).toContain("text-danger");

    sync.apply(status({ loggedIn: false }));
    await flushPromises();
    expect(button().classes()).toContain("text-muted");
    expect(button().attributes("aria-label")).toBe(
      "Réglages du serveur. Synchro désactivée : tes notes restent sur cet appareil.",
    );
  });

  it("turns orange only for a sync that lasts", async () => {
    vi.useFakeTimers();
    const { wrapper, sync } = await mountDot();
    sync.apply(status({ state: "idle" }));
    await flushPromises();
    sync.apply(status({ state: "syncing" }));
    await flushPromises();
    expect(wrapper.find("button").classes()).toContain("text-ok");
    await vi.advanceTimersByTimeAsync(400);
    expect(wrapper.find("button").classes()).toContain("text-spark");
    sync.apply(status({ state: "idle" }));
    await flushPromises();
    expect(wrapper.find("button").classes()).toContain("text-ok");
  });

  it("syncs when clicked, and says when it failed", async () => {
    const { wrapper, sync } = await mountDot();
    sync.apply(status({}));
    core.sync = status({ state: "offline", errorKind: "network" });

    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(core.calls.map((call) => call.cmd)).toContain("sync_now");
    expect(useToastsStore().toasts[0]?.message).toBe("Serveur injoignable. La synchro reprendra toute seule.");
  });

  it("opens the server settings when no server is connected", async () => {
    const { wrapper, router, sync } = await mountDot();
    sync.apply(status({ loggedIn: false }));
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("settings");
    expect(router.currentRoute.value.hash).toBe("#server");
  });
});
