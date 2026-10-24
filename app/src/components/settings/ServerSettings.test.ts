import { clearMocks } from "@tauri-apps/api/mocks";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSyncStore } from "../../stores/sync";
import { type FakeCore, installFakeCore } from "../../test/fake-core";
import ServerSettings from "./ServerSettings.vue";

async function mountSettings() {
  const pinia = createPinia();
  setActivePinia(pinia);
  await useSyncStore().load();
  const wrapper = mount(ServerSettings, { attachTo: document.body, global: { plugins: [pinia] } });
  return wrapper;
}

enableAutoUnmount(afterEach);

describe("server settings", () => {
  let core: FakeCore;

  beforeEach(() => {
    core = installFakeCore();
  });
  afterEach(() => {
    clearMocks();
    document.body.innerHTML = "";
  });

  it("logs in with the server, the account and the device name", async () => {
    const wrapper = await mountSettings();
    expect((wrapper.find('input[type="url"]').element as HTMLInputElement).value).toBe(
      "https://meche.pierrebultez.com",
    );
    await wrapper.find('input[type="email"]').setValue("pierre@example.com");
    await wrapper.find('input[type="password"]').setValue("correct horse battery");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(core.calls).toContainEqual({
      cmd: "login",
      args: {
        serverUrl: "https://meche.pierrebultez.com",
        email: "pierre@example.com",
        password: "correct horse battery",
        deviceName: "PC de test",
      },
    });
    expect(wrapper.text()).toContain("Synchroniser maintenant");
    expect(wrapper.text()).toContain("pierre@example.com");
  });

  it("says in French why the login failed", async () => {
    const wrapper = await mountSettings();
    core.fail("login", { kind: "invalid_credentials" });
    await wrapper.find('input[type="email"]').setValue("pierre@example.com");
    await wrapper.find('input[type="password"]').setValue("wrong");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe("Adresse e-mail ou mot de passe incorrect.");
  });

  it("creates an account with an invitation code", async () => {
    const wrapper = await mountSettings();
    await wrapper.findAll("button[aria-pressed]")[1].trigger("click");
    await wrapper.find('input[placeholder="XXXX-XXXX-XXXX"]').setValue("7kq2-m9xd-4tph");
    await wrapper.find('input[type="email"]').setValue("papa@example.com");
    await wrapper.find('input[type="password"]').setValue("une phrase de passe");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(core.calls.find((call) => call.cmd === "register")?.args).toMatchObject({
      invitationCode: "7kq2-m9xd-4tph",
      email: "papa@example.com",
    });
  });

  it("asks before syncing this device with another account", async () => {
    core.sync.email = "pierre@example.com";
    const wrapper = await mountSettings();
    await wrapper.find('input[type="email"]').setValue("papa@example.com");
    await wrapper.find('input[type="password"]').setValue("une phrase de passe");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(core.calls.some((call) => call.cmd === "login")).toBe(false);
    expect(wrapper.find("dialog").text()).toContain("Ses notes seront envoyées vers le compte papa@example.com");
  });

  it("asks before syncing this device with the same account on another server", async () => {
    core.sync.email = "pierre@example.com";
    core.sync.serverUrl = "https://meche.pierrebultez.com";
    const wrapper = await mountSettings();
    const urlInput = () => wrapper.find('input[type="url"]');
    await wrapper.find('input[type="email"]').setValue("pierre@example.com");
    await wrapper.find('input[type="password"]').setValue("une phrase de passe");

    // The same server, typed without https://: no question.
    await urlInput().setValue("meche.pierrebultez.com");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(core.calls.filter((call) => call.cmd === "login")).toHaveLength(1);

    core.sync.loggedIn = false;
    await useSyncStore().load();
    await flushPromises();
    await urlInput().setValue("https://notes.example.com");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(core.calls.filter((call) => call.cmd === "login")).toHaveLength(1);
    expect(wrapper.find("dialog").text()).toContain("(notes.example.com)");
  });

  it("tests the address of the server", async () => {
    const wrapper = await mountSettings();
    core.fail("check_server", { kind: "not_meche_server" });
    await wrapper.findAll("button").find((button) => button.text() === "Tester")?.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Aucun serveur Mèche à cette adresse.");
  });

  it("logs out, keeping the notes", async () => {
    core.sync = { ...core.sync, loggedIn: true, email: "pierre@example.com", serverUrl: "https://m.example" };
    const wrapper = await mountSettings();
    await wrapper.findAll("button").find((button) => button.text() === "Se déconnecter")?.trigger("click");
    await flushPromises();
    expect(core.calls.map((call) => call.cmd)).toContain("logout");
    expect(wrapper.find("form").exists()).toBe(true);
  });
});
