import { clearMocks } from "@tauri-apps/api/mocks";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { type FakeCore, installFakeCore } from "../test/fake-core";
import type { Note } from "../types/note";
import TriageView from "./TriageView.vue";

async function mountTriage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/tri", name: "triage", component: TriageView },
      { path: "/notes/:noteId?", name: "notes", component: { render: () => null } },
      { path: "/import", component: { render: () => null } },
    ],
  });
  await router.push("/tri");
  const wrapper = mount(TriageView, { attachTo: document.body, global: { plugins: [pinia, router] } });
  await flushPromises();
  return { wrapper, router };
}

const note = (id: string, title: string, updatedAt: number): Note => ({
  id,
  title,
  content: `Contenu de ${title}`,
  kind: "rich",
  codeLanguage: null,
  pinned: false,
  color: "pomme",
  ephemeralMode: null,
  ephemeralDelayHours: null,
  ephemeralStartedAt: null,
  destroyAt: null,
  trashedAt: null,
  trashReason: null,
  createdAt: updatedAt,
  updatedAt,
});

/** A key pressed on the page (the shortcuts listen to the window). */
async function press(key: string, options: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  await flushPromises();
}

enableAutoUnmount(afterEach);

describe("triage screen (docs/07)", () => {
  let core: FakeCore;

  beforeEach(() => {
    core = installFakeCore();
    core.notes = [note("a", "Ancienne", 1), note("b", "Moyenne", 2), note("c", "Récente", 3)];
    core.triage.waiting = ["a", "b", "c"];
  });
  afterEach(() => clearMocks());

  const title = (wrapper: Awaited<ReturnType<typeof mountTriage>>["wrapper"]) => wrapper.find("article h2").text();
  const decisions = () => core.calls.filter((call) => call.cmd === "triage_decide").map((call) => [call.args.id, call.args.decision]);

  it("shows one note at a time, the oldest first, with the progress", async () => {
    const { wrapper } = await mountTriage();
    expect(title(wrapper)).toBe("Ancienne");
    expect(wrapper.text()).toContain("0 / 3");
    expect(wrapper.find("article").attributes("data-note-color")).toBe("pomme");
  });

  it("decides with the keyboard: G or →, E, S or ←, Espace", async () => {
    core.notes.push(note("d", "Quatre", 4), note("e", "Cinq", 5));
    core.triage.waiting.push("d", "e");
    const { wrapper } = await mountTriage();
    await press("g");
    await press("e");
    await press("ArrowLeft");
    await press(" ");
    expect(decisions()).toEqual([
      ["a", "keep"],
      ["b", "fuse"],
      ["c", "trash"],
      ["d", "skip"],
    ]);
    expect(title(wrapper)).toBe("Cinq");
    expect(wrapper.text()).toContain("3 / 5");
    expect(core.notes.find((n) => n.id === "b")?.ephemeralMode).toBe("delay");
    expect(core.notes.find((n) => n.id === "c")?.trashedAt).not.toBeNull();
    await press("ArrowRight");
    await press("s");
    expect(decisions().slice(4)).toEqual([
      ["e", "keep"],
      ["d", "trash"],
    ]);
  });

  it("ignores a key held down, and keys typed with Ctrl or Alt", async () => {
    await mountTriage();
    await press("g", { repeat: true });
    await press("s", { ctrlKey: true });
    await press("e", { altKey: true });
    expect(decisions()).toEqual([]);
  });

  it("decides with the buttons", async () => {
    const { wrapper } = await mountTriage();
    const button = (label: string) => wrapper.findAll("button").find((b) => b.text().startsWith(label))!;
    await button("Supprimer").trigger("click");
    await flushPromises();
    await button("Garder").trigger("click");
    await flushPromises();
    expect(decisions()).toEqual([
      ["a", "trash"],
      ["b", "keep"],
    ]);
  });

  it("undoes the latest decisions, one after the other (Ctrl+Z)", async () => {
    const { wrapper } = await mountTriage();
    await press("s");
    await press("e");
    expect(title(wrapper)).toBe("Récente");
    await press("z", { ctrlKey: true });
    expect(title(wrapper)).toBe("Moyenne");
    expect(core.notes.find((n) => n.id === "b")?.ephemeralMode).toBeNull();
    await press("z", { ctrlKey: true });
    expect(title(wrapper)).toBe("Ancienne");
    expect(core.notes.find((n) => n.id === "a")?.trashedAt).toBeNull();
    expect(wrapper.text()).toContain("0 / 3");
    // Nothing more to undo.
    await press("z", { ctrlKey: true });
    expect(core.calls.filter((call) => call.cmd === "triage_undo")).toHaveLength(2);
  });

  it("swipes right to keep, left to trash, on a touch screen", async () => {
    const { wrapper } = await mountTriage();
    const swipe = async (distance: number, pointerType = "touch") => {
      const card = wrapper.find("article");
      await card.trigger("pointerdown", { clientX: 200, pointerId: 1, pointerType });
      await card.trigger("pointermove", { clientX: 200 + distance, pointerId: 1, pointerType });
      await card.trigger("pointerup", { clientX: 200 + distance, pointerId: 1, pointerType });
      await flushPromises();
    };
    await swipe(40); // Too short: nothing.
    await swipe(200, "mouse"); // With a mouse, the text stays selectable.
    await swipe(160);
    await swipe(-160);
    expect(decisions()).toEqual([
      ["a", "keep"],
      ["b", "trash"],
    ]);
  });

  it("ends with the counts, and starts again from zero once closed", async () => {
    const { wrapper, router } = await mountTriage();
    await press("g");
    await press("e");
    await press("s");
    expect(wrapper.text()).toContain("C'est trié !");
    expect(wrapper.text()).toContain("1 gardée, 1 mèche allumée, 1 à la corbeille.");
    await wrapper.findAll("button").find((b) => b.text() === "Voir mes notes")!.trigger("click");
    await flushPromises();
    expect(core.triage.counts).toEqual({ kept: 0, fused: 0, trashed: 0 });
    expect(router.currentRoute.value.path).toBe("/notes");
  });

  it("says when there is nothing to triage", async () => {
    core.triage.waiting = [];
    const { wrapper } = await mountTriage();
    expect(wrapper.text()).toContain("Aucune note à trier.");
  });

  it("keeps the note on screen when a decision fails", async () => {
    core.fail("triage_decide", { kind: "database" });
    const { wrapper } = await mountTriage();
    await press("g");
    expect(title(wrapper)).toBe("Ancienne");
    await press("g");
    expect(title(wrapper)).toBe("Moyenne");
  });
});
