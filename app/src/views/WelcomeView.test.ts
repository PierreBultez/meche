import { clearMocks } from "@tauri-apps/api/mocks";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { type FakeCore, installFakeCore } from "../test/fake-core";
import WelcomeView from "./WelcomeView.vue";

async function mountWelcome() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/welcome", component: WelcomeView },
      { path: "/notes", component: { render: () => null } },
      { path: "/settings", name: "settings", component: { render: () => null } },
    ],
  });
  await router.push("/welcome");
  const wrapper = mount(WelcomeView, { global: { plugins: [pinia, router] } });
  return { wrapper, router };
}

enableAutoUnmount(afterEach);

describe("first launch (docs/08)", () => {
  let core: FakeCore;

  beforeEach(() => {
    core = installFakeCore();
  });
  afterEach(() => clearMocks());

  function settingsWrites(): unknown[] {
    return core.calls.filter((call) => call.cmd === "set_settings").map((call) => call.args.patch);
  }

  it("goes to the server settings, and is not asked again", async () => {
    const { wrapper, router } = await mountWelcome();
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    expect(settingsWrites()).toEqual([{ welcomeDone: true }]);
    expect(router.currentRoute.value.name).toBe("settings");
    expect(router.currentRoute.value.hash).toBe("#server");
  });

  it("goes to the notes when used offline", async () => {
    const { wrapper, router } = await mountWelcome();
    await wrapper.findAll("button")[1].trigger("click");
    await flushPromises();
    expect(settingsWrites()).toEqual([{ welcomeDone: true }]);
    expect(router.currentRoute.value.path).toBe("/notes");
  });
});
