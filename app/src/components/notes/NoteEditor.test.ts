// The open note explodes (docs/06): where does the keyboard focus go?
import { clearMocks } from "@tauri-apps/api/mocks";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { installFakeCore } from "../../test/fake-core";
import type { Note } from "../../types/note";
import NoteEditor from "./NoteEditor.vue";

const burning: Note = {
  id: "n1",
  title: "Courses",
  content: "Lait",
  kind: "rich",
  codeLanguage: null,
  pinned: false,
  color: "violet",
  ephemeralMode: "delay",
  ephemeralDelayHours: 1,
  ephemeralStartedAt: 0,
  destroyAt: Date.now() + 60_000,
  trashedAt: null,
  trashReason: null,
  createdAt: 0,
  updatedAt: 0,
};

/** Mounts the editor of a burning note; `explode()` gives it the note as Rust reloads it. */
async function openBurningNote() {
  installFakeCore();
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:path(.*)*", component: { render: () => null } }],
  });
  const note = ref<Note>(burning);
  const host = defineComponent({ setup: () => () => h(NoteEditor, { note: note.value }) });
  const wrapper = mount(host, { attachTo: document.body, global: { plugins: [pinia, router] } });
  await flushPromises();
  async function explode(): Promise<void> {
    note.value = { ...burning, trashedAt: burning.destroyAt, trashReason: "self_destruct" };
    await flushPromises();
    await nextTick();
  }
  return { wrapper, explode };
}

describe("focus when the open note explodes", () => {
  afterEach(() => {
    clearMocks();
    document.body.innerHTML = "";
  });

  it("goes from a removed header button to « Restaurer »", async () => {
    const { wrapper, explode } = await openBurningNote();
    (wrapper.find('button[aria-label="Épingler"]').element as HTMLElement).focus();
    await explode();
    expect(document.activeElement?.textContent).toContain("Restaurer (la mèche est éteinte)");
    wrapper.unmount();
  });

  it("stays in the title being typed: a key typed next must not restore the note", async () => {
    const { wrapper, explode } = await openBurningNote();
    const title = wrapper.find("input").element;
    title.focus();
    await explode();
    expect(document.activeElement).toBe(title);
    wrapper.unmount();
  });
});
