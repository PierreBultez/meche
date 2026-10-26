import { clearMocks } from "@tauri-apps/api/mocks";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { BACKUP, backupFromRust } from "../import/__fixtures__/backup";
import type { ImportedNote } from "../import/types";
import { useToastsStore } from "../stores/toasts";
import { type FakeCore, installFakeCore } from "../test/fake-core";
import ImportView from "./ImportView.vue";

async function mountImport(pinia = createPinia()) {
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/import", name: "import", component: ImportView },
      { path: "/tri", name: "triage", component: { render: () => null } },
      { path: "/notes", component: { render: () => null } },
      { path: "/settings", component: { render: () => null } },
    ],
  });
  await router.push("/import");
  const wrapper = mount(ImportView, { global: { plugins: [pinia, router] } });
  return { wrapper, router };
}

enableAutoUnmount(afterEach);

// The converters pause between notes: on a busy machine (CI, the other test files alongside),
// reading and converting the backup takes more than the second vi.waitFor gives by default.
const SLOW = { timeout: 10_000 };

describe("import screen (docs/07)", { timeout: 30_000 }, () => {
  let core: FakeCore;

  beforeEach(() => {
    core = installFakeCore();
    core.backup = backupFromRust(BACKUP.items as Array<Record<string, unknown>>);
  });
  afterEach(() => clearMocks());

  const button = (wrapper: Awaited<ReturnType<typeof mountImport>>["wrapper"], label: string) =>
    wrapper.findAll("button").find((b) => b.text().startsWith(label))!;

  async function chooseBackup(wrapper: Awaited<ReturnType<typeof mountImport>>["wrapper"]) {
    await button(wrapper, "Choisir la sauvegarde").trigger("click");
    // The converters are loaded on demand (a dynamic import), and pause between notes: wait
    // until the file is read and converted.
    await vi.waitFor(() => expect(wrapper.text()).not.toMatch(/Lecture de la sauvegarde|Conversion des notes/), SLOW);
    await flushPromises();
  }

  it("shows the summary of the backup before importing anything", async () => {
    const { wrapper } = await mountImport();
    await chooseBackup(wrapper);
    const text = wrapper.text();
    expect(text).toContain("11 notes trouvées : 3 textes, 1 Markdown, 1 texte enrichi, 1 Super, 2 checklists, 2 notes de code, 1 autre.");
    expect(text).toContain("4 notes non converties parfaitement");
    expect(text).toContain("Recette — images ignorées");
    expect(text).toContain("Pas importés : 1 note de la corbeille de Standard Notes, 1 note supprimée ou illisible, 1 fichier joint absent de la sauvegarde, 2 réglages et extensions.");
    expect(core.calls.some((call) => call.cmd === "import_notes")).toBe(false);
  });

  it("imports the notes, then offers the triage", async () => {
    const { wrapper, router } = await mountImport();
    await chooseBackup(wrapper);
    await button(wrapper, "Importer 11 notes").trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("importées"), SLOW);
    const sent = core.calls.find((call) => call.cmd === "import_notes")?.args.notes as ImportedNote[];
    expect(sent).toHaveLength(11);
    expect(wrapper.text()).toContain("11 notes importées.");
    expect(wrapper.text()).toContain("Faire le tri maintenant ? (environ 2 min)");
    await button(wrapper, "Trier maintenant").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/tri");
  });

  it("says when every note was there already", async () => {
    const { wrapper } = await mountImport();
    await chooseBackup(wrapper);
    await button(wrapper, "Importer").trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("importées"), SLOW);
    // Same backup again: nothing new, and nothing to triage once the first triage is done.
    core.triage.waiting = [];
    const again = await mountImport();
    await chooseBackup(again.wrapper);
    await button(again.wrapper, "Importer").trigger("click");
    await vi.waitFor(() => expect(again.wrapper.text()).toContain("Rien de nouveau"), SLOW);
    expect(again.wrapper.text()).toContain("Rien de nouveau : ces notes sont déjà dans Mèche.");
    expect(core.notes).toHaveLength(11);
  });

  it("stays on the first step when the file chooser is closed", async () => {
    core.backup = null;
    const { wrapper } = await mountImport();
    await chooseBackup(wrapper);
    expect(button(wrapper, "Choisir la sauvegarde").exists()).toBe(true);
  });

  it("explains why a file cannot be read", async () => {
    core.fail("read_import_file", { kind: "backup_encrypted" });
    const { wrapper } = await mountImport();
    await chooseBackup(wrapper);
    expect(useToastsStore().toasts.map((toast) => toast.message)).toEqual([
      "Cette sauvegarde est chiffrée. Dans Standard Notes, télécharge une sauvegarde sans chiffrement.",
    ]);
  });

  it("shows the notes imported even when the triage cannot be reloaded", async () => {
    const { wrapper } = await mountImport();
    await chooseBackup(wrapper);
    core.fail("get_triage", { kind: "database" });
    await button(wrapper, "Importer 11 notes").trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("11 notes importées."), SLOW);
    expect(useToastsStore().toasts).toEqual([]);
  });

  it("forgets a backup still being read when the page is left (Échap)", async () => {
    const pinia = createPinia();
    const first = await mountImport(pinia);
    void button(first.wrapper, "Choisir la sauvegarde").trigger("click");
    first.wrapper.unmount();
    // Long enough for the conversion to end, had it gone on.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();
    const again = await mountImport(pinia);
    expect(button(again.wrapper, "Choisir la sauvegarde").exists()).toBe(true);
    expect(again.wrapper.text()).not.toContain("notes trouvées");
  });

  it("goes back to the choice when the summary is cancelled", async () => {
    const { wrapper } = await mountImport();
    await chooseBackup(wrapper);
    await button(wrapper, "Annuler").trigger("click");
    await flushPromises();
    expect(button(wrapper, "Choisir la sauvegarde").exists()).toBe(true);
  });
});
