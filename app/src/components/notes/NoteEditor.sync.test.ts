// The open note changes on another device (docs/04): the editor shows the new version in place
// and never loses, nor writes over it, what was being typed.
import { clearMocks } from "@tauri-apps/api/mocks";
import type { Editor } from "@tiptap/core";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { useNotesStore } from "../../stores/notes";
import { useToastsStore } from "../../stores/toasts";
import { type FakeCore, installFakeCore } from "../../test/fake-core";
import NoteEditor from "./NoteEditor.vue";

const COPY_TOAST =
  "Cette note a changé sur un autre appareil. Ce que tu venais d'écrire est gardé dans une copie « (conflit du …) ».";

/** Waits until the rich editor exists (it is loaded on demand). */
async function richEditor(): Promise<Editor> {
  for (let tries = 0; tries < 50; tries++) {
    await flushPromises();
    const element = document.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null;
    if (element?.editor) return element.editor;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the rich editor never appeared");
}

/** Opens a note in an editor keyed like NotesView's. */
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
  const shown = ref(true);
  const host = defineComponent({
    setup: () => () =>
      notes.current && shown.value
        ? h(NoteEditor, { note: notes.current, key: `${notes.current.id}:${notes.current.kind}` })
        : null,
  });
  const wrapper = mount(host, { attachTo: document.body, global: { plugins: [pinia, router] } });
  const editor = await richEditor();
  // The text takes the focus on opening, one animation frame later (TipTap's focus command).
  await new Promise((resolve) => setTimeout(resolve, 50));
  const titleInput = () => wrapper.find("input").element as HTMLInputElement;
  /** Another device changed the note; the sync applied it and sent notes-changed. */
  async function changedElsewhere(change: { title?: string; content?: string }): Promise<void> {
    Object.assign(core.notes[0], change);
    await notes.reload();
    await flushPromises();
  }
  /** Types in the text, at the end. */
  function typeInText(text: string): void {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, text);
  }
  const flush = () =>
    (wrapper.findComponent(NoteEditor).vm as unknown as { flush: () => Promise<void> }).flush();
  const toasts = () => useToastsStore().toasts.map((toast) => toast.message);
  const copies = () => core.notes.filter((stored) => stored.title.includes("(conflit du"));
  return { core, notes, wrapper, editor, shown, titleInput, changedElsewhere, typeInText, flush, toasts, copies };
}

enableAutoUnmount(afterEach);

describe("the open note changes on another device", () => {
  afterEach(() => {
    clearMocks();
    document.body.innerHTML = "";
  });

  it("shows the new version in place when nothing is being typed", async () => {
    const { core, editor, titleInput, changedElsewhere, toasts } = await openNote();
    const input = titleInput();
    input.focus();
    await changedElsewhere({ title: "Courses Lidl", content: "Lait, pain" });

    // The same field and the same editor: nothing was mounted again, the focus stayed.
    expect(titleInput()).toBe(input);
    expect(input.value).toBe("Courses Lidl");
    expect(document.activeElement).toBe(input);
    expect(document.querySelector(".ProseMirror") as unknown).toBe(editor.view.dom);
    expect(editor.getText()).toBe("Lait, pain");
    expect(core.notes).toHaveLength(1);
    expect(toasts()).toEqual([]);
    // Shown, not saved again.
    expect(core.calls.filter((call) => call.cmd === "update_note")).toHaveLength(1);
  });

  it("keeps the text being typed in one copy with the typed title, and shows the new version", async () => {
    const { core, editor, titleInput, changedElsewhere, typeInText, toasts, copies } =
      await openNote();
    // Typed less than 400 ms ago: not saved yet. Both the title and the text.
    titleInput().value = "Courses du samedi";
    titleInput().dispatchEvent(new Event("input"));
    typeInText(", beurre");

    await changedElsewhere({ title: "Courses Lidl", content: "Lait, pain" });

    expect(core.notes[0]).toMatchObject({ title: "Courses Lidl", content: "Lait, pain" });
    expect(copies().map((copy) => [copy.title, copy.content])).toEqual([
      ["Courses du samedi (conflit du 22/10 14:05)", "Lait, beurre"],
    ]);
    expect(titleInput().value).toBe("Courses Lidl");
    expect(editor.getText()).toBe("Lait, pain");
    expect(toasts()).toEqual([COPY_TOAST]);
  });

  it("keeps the whole version shown when only the text was typed", async () => {
    const { core, typeInText, changedElsewhere, copies } = await openNote();
    typeInText(", beurre");

    await changedElsewhere({ title: "Courses Lidl" });

    expect(core.notes[0]).toMatchObject({ title: "Courses Lidl", content: "Lait" });
    expect(copies().map((copy) => [copy.title, copy.content])).toEqual([
      ["Courses (conflit du 22/10 14:05)", "Lait, beurre"],
    ]);
  });

  it("never writes over the other version while the copy is being saved", async () => {
    const { core, editor, titleInput, changedElsewhere, typeInText, copies } = await openNote();
    typeInText(", beurre");
    const held = core.hold("update_note");
    const changing = changedElsewhere({ content: "Version d'ailleurs" });
    await flushPromises();
    // Typed again while the first copy is on its way.
    typeInText(", sel");
    held.release();
    await changing;
    await flushPromises();

    expect(core.notes[0].content).toBe("Version d'ailleurs");
    expect(copies().map((copy) => copy.content)).toEqual(["Lait, beurre", "Lait, beurre, sel"]);
    expect(editor.getText()).toBe("Version d'ailleurs");
    expect(titleInput().value).toBe("Courses");
  });

  it("never writes over the other version when the note is closed right after", async () => {
    const { core, shown, changedElsewhere, typeInText, toasts, copies } = await openNote();
    typeInText(", beurre");
    const held = core.hold("update_note");
    const changing = changedElsewhere({ content: "Version d'ailleurs" });
    await flushPromises();
    typeInText(", sel");
    // Another note is opened: the editor saves one last time and goes away.
    shown.value = false;
    await nextTick();
    held.release();
    await changing;
    await flushPromises();

    expect(core.notes[0].content).toBe("Version d'ailleurs");
    expect(copies().map((copy) => copy.content)).toEqual(["Lait, beurre", "Lait, beurre, sel"]);
    expect(toasts()).toEqual([COPY_TOAST]);
  });

  it("says so when the last save of a closed editor was kept in a copy", async () => {
    const { core, shown, typeInText, toasts, copies } = await openNote();
    typeInText(", beurre");
    // Changed elsewhere, but the editor is closed before it hears of it.
    core.notes[0].content = "Version d'ailleurs";
    shown.value = false;
    await flushPromises();

    expect(copies()).toHaveLength(1);
    expect(toasts()).toEqual([COPY_TOAST]);
  });

  it("keeps on screen a text that could not be saved", async () => {
    const { core, editor, flush, changedElsewhere, typeInText, toasts, copies } = await openNote();
    typeInText(", beurre");
    core.fail("update_note", { kind: "database", message: "disk full" });

    await changedElsewhere({ content: "Version d'ailleurs" });

    expect(editor.getText()).toBe("Lait, beurre");
    expect(toasts()).toEqual([
      "Impossible d'enregistrer la note. Tes dernières modifications sont gardées ici.",
    ]);
    // Saved at the next try: in a copy, since the note changed; then the new version shows.
    await flush();
    await flushPromises();
    expect(copies().map((copy) => copy.content)).toEqual(["Lait, beurre"]);
    expect(core.notes[0].content).toBe("Version d'ailleurs");
    expect(editor.getText()).toBe("Version d'ailleurs");
  });

  it("keeps the text of a note deleted for good elsewhere in a new note", async () => {
    const { core, flush, typeInText, toasts } = await openNote();
    typeInText(", beurre");
    core.notes.splice(0, 1);

    await flush();
    typeInText(", sel");
    await flush();

    expect(core.notes.map((note) => [note.title, note.content])).toEqual([
      ["Courses", "Lait, beurre, sel"],
    ]);
    expect(toasts()).toEqual([
      "Cette note a été supprimée sur un autre appareil. Ce que tu venais d'écrire est gardé dans une nouvelle note.",
    ]);
  });

  it("the caret follows the text when the new version changes what is before it", async () => {
    const { editor, changedElsewhere, flush } = await openNote();
    editor.commands.focus("end");
    await flush();

    await changedElsewhere({ content: "Pain, lait" });
    editor.commands.insertContent(" frais");
    await flush();

    expect(editor.isFocused).toBe(true);
    expect(editor.getText()).toBe("Pain, lait frais");
  });

  it("a new version from elsewhere is not undoable", async () => {
    const { editor, changedElsewhere, flush } = await openNote();
    editor.commands.focus("end");
    await changedElsewhere({ content: "Version d'ailleurs" });
    editor.commands.undo();
    await flush();
    expect(editor.getText()).toBe("Version d'ailleurs");
  });

  it("a new title from elsewhere leaves the text being typed alone", async () => {
    const { editor, changedElsewhere, typeInText, flush } = await openNote();
    editor.commands.focus("end");
    typeInText(", beurre");
    await flush();
    const caret = editor.state.selection.from;

    await changedElsewhere({ title: "Courses Lidl" });

    expect(editor.isFocused).toBe(true);
    expect(editor.state.selection.from).toBe(caret);
    expect(editor.getText()).toBe("Lait, beurre");
  });

  it("sends the text it believes stored with each save", async () => {
    const { core, titleInput } = await openNote();
    titleInput().value = "Courses du samedi";
    titleInput().dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flushPromises();
    const save = core.calls.filter((call) => call.cmd === "update_note").at(-1);
    expect(save?.args.patch).toEqual({
      title: "Courses du samedi",
      expectedTitle: "Courses",
      expectedContent: "Lait",
    });
  });

  it("does not reload for its own saves, nor for other notes", async () => {
    const { core, editor, titleInput, changedElsewhere, typeInText, flush, copies } =
      await openNote();
    titleInput().value = "Courses du samedi";
    titleInput().dispatchEvent(new Event("input"));
    typeInText(", beurre");
    await flush();
    core.notes.push({ ...core.notes[0], id: "elsewhere", title: "Autre note" });
    await changedElsewhere({});

    expect(copies()).toEqual([]);
    expect(core.notes[0]).toMatchObject({ title: "Courses du samedi", content: "Lait, beurre" });
    expect(titleInput().value).toBe("Courses du samedi");
    expect(editor.getText()).toBe("Lait, beurre");
  });
});
