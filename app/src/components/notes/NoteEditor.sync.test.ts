// The open note changes on another device (docs/04): the editor shows the new version and never
// loses, nor writes over it, what was being typed.
import { clearMocks } from "@tauri-apps/api/mocks";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { useNotesStore } from "../../stores/notes";
import { useToastsStore } from "../../stores/toasts";
import { type FakeCore, installFakeCore } from "../../test/fake-core";
import NoteEditor from "./NoteEditor.vue";

/** Opens a note in an editor keyed like NotesView's, so that reopen() mounts it again. */
async function openNote() {
  const core: FakeCore = installFakeCore();
  const pinia = createPinia();
  setActivePinia(pinia);
  const notes = useNotesStore();
  const note = await notes.create("rich");
  await notes.save(note.id, { title: "Courses", content: "Lait" });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:path(.*)*", component: { render: () => null } }],
  });
  const host = defineComponent({
    setup: () => () =>
      notes.current
        ? h(NoteEditor, { note: notes.current, key: `${notes.current.id}:${notes.editorGeneration}` })
        : null,
  });
  const wrapper = mount(host, { attachTo: document.body, global: { plugins: [pinia, router] } });
  await flushPromises();
  /** Another device changed the note; the sync applied it and sent notes-changed. */
  async function changedElsewhere(change: { title?: string; content?: string }): Promise<void> {
    Object.assign(core.notes[0], change);
    await notes.reload();
    await flushPromises();
  }
  return { core, notes, wrapper, changedElsewhere };
}

enableAutoUnmount(afterEach);

describe("the open note changes on another device", () => {
  afterEach(() => {
    clearMocks();
    document.body.innerHTML = "";
  });

  it("shows the new version when nothing is being typed", async () => {
    const { core, notes, wrapper, changedElsewhere } = await openNote();

    await changedElsewhere({ title: "Courses Lidl", content: "Lait, pain" });

    expect(notes.editorGeneration).toBe(1);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Courses Lidl");
    expect(core.notes).toHaveLength(1);
    expect(useToastsStore().toasts).toEqual([]);
  });

  it("keeps what was being typed in a copy, and shows the new version", async () => {
    const { core, notes, wrapper, changedElsewhere } = await openNote();
    const title = wrapper.find("input");
    // Typed less than 400 ms ago: not saved yet.
    await title.setValue("Courses du samedi");

    await changedElsewhere({ title: "Courses Lidl" });

    expect(core.notes.map((note) => note.title)).toEqual([
      "Courses Lidl",
      "Courses du samedi (conflit du 22/10 14:05)",
    ]);
    expect(notes.editorGeneration).toBe(1);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Courses Lidl");
    expect(useToastsStore().toasts.map((toast) => toast.message)).toEqual([
      "Cette note a changé sur un autre appareil. Ce que tu venais d'écrire est gardé dans une copie « (conflit du …) ».",
    ]);
  });

  it("sends the text it believes stored with each save", async () => {
    const { core, wrapper } = await openNote();
    await wrapper.find("input").setValue("Courses du samedi");
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flushPromises();
    const save = core.calls.filter((call) => call.cmd === "update_note").at(-1);
    expect(save?.args.patch).toEqual({ title: "Courses du samedi", expectedTitle: "Courses" });
  });

  it("does not reload for its own saves, nor for other notes", async () => {
    const { core, notes, wrapper, changedElsewhere } = await openNote();
    await wrapper.find("input").setValue("Courses du samedi");
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flushPromises();
    core.notes.push({ ...core.notes[0], id: "elsewhere", title: "Autre note" });
    await changedElsewhere({});

    expect(notes.editorGeneration).toBe(0);
    expect(core.notes[0].title).toBe("Courses du samedi");
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Courses du samedi");
  });
});
