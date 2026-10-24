// A version brought by the sync shown in place (docs/04): a caret at the start or the end of
// its paragraph (or line), when the other device wrote before and after it, stays there.
import { EditorView } from "@codemirror/view";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import CodeEditor from "./CodeEditor.vue";
import RichEditor from "./RichEditor.vue";

enableAutoUnmount(afterEach);
afterEach(() => {
  document.body.innerHTML = "";
});

async function codeEditor(content: string) {
  const wrapper = mount(CodeEditor, { props: { content, language: null, wrap: false, editable: true }, attachTo: document.body });
  await flushPromises();
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
  const replace = (text: string) => (wrapper.vm as unknown as { replace: (t: string) => string }).replace(text);
  return { view, replace };
}

async function richEditor(content: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(RichEditor, { props: { content, editable: true }, attachTo: document.body, global: { plugins: [pinia] } });
  let editor: Editor | undefined;
  for (let i = 0; i < 100 && !editor; i++) {
    await flushPromises();
    editor = (document.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null)?.editor;
    if (!editor) await new Promise((r) => setTimeout(r, 10));
  }
  const replace = (markdown: string) => (wrapper.vm as unknown as { replace: (m: string) => string }).replace(markdown);
  return { editor: editor!, replace };
}

/** Caret in the first text block whose text is `block`, at `offset`. */
function caretIn(editor: Editor, block: string, offset: number): void {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === block) found = pos + 1 + offset;
    return found < 0;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found)));
}
const where = (editor: Editor) => [editor.state.selection.$from.parent.textContent, editor.state.selection.$from.parentOffset];

describe("rich: the other device wrote a paragraph before and one after", () => {
  for (const [name, offset] of [["start", 0], ["middle", 2], ["end", 5]] as const) {
    it(`caret at the ${name} of « Intro », paragraph after`, async () => {
      const { editor, replace } = await richEditor("Intro");
      editor.commands.focus();
      caretIn(editor, "Intro", offset);
      replace("Avant\n\nIntro\n\nAprès");
      expect(where(editor)).toEqual(["Intro", offset]);
    });
    it(`caret at the ${name} of « Intro », table after (the real-app case)`, async () => {
      const { editor, replace } = await richEditor("Intro");
      editor.commands.focus();
      caretIn(editor, "Intro", offset);
      replace("Avant\n\nIntro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
      expect(where(editor)).toEqual(["Intro", offset]);
    });
    it(`caret at the ${name} of « Intro », table before and paragraph after`, async () => {
      const { editor, replace } = await richEditor("Intro");
      editor.commands.focus();
      caretIn(editor, "Intro", offset);
      replace("| a | b |\n| --- | --- |\n| 1 | 2 |\n\nIntro\n\nAprès");
      expect(where(editor)).toEqual(["Intro", offset]);
    });
  }
});

describe("code: the other device wrote a line before and one after", () => {
  for (const [name, column] of [["start", 0], ["middle", 4], ["end", 9]] as const) {
    it(`caret at the ${name} of « make test »`, async () => {
      const { view, replace } = await codeEditor("make test");
      view.dispatch({ selection: { anchor: column } });
      replace("avant\nmake test\naprès");
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      expect([line.text, head - line.from]).toEqual(["make test", column]);
    });
  }
});
