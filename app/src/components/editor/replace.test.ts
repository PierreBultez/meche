// A version brought by the sync shown in place (docs/04): the caret and the selection stay
// where they belong, the text is the stored one.
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CodeEditor from "./CodeEditor.vue";
import RichEditor from "./RichEditor.vue";
import { createRichExtensions } from "../../editor/extensions";
import { followCaretInDocument } from "../../editor/follow-caret";

enableAutoUnmount(afterEach);
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  document.body.innerHTML = "";
});

async function codeEditor(content: string) {
  const wrapper = mount(CodeEditor, {
    props: { content, language: null, wrap: false, editable: true },
    attachTo: document.body,
  });
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
  const replace = (markdown: string) =>
    (wrapper.vm as unknown as { replace: (m: string) => string }).replace(markdown);
  return { editor: editor!, replace };
}

function caretAfter(editor: Editor, text: string, nth = 0): void {
  const found: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    let index = node.text!.indexOf(text);
    while (index >= 0) {
      found.push(pos + index + text.length);
      index = node.text!.indexOf(text, index + 1);
    }
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found[nth])));
}

describe("code editor: a line edited elsewhere while the caret is on it", () => {
  it("the caret stays on that line (another line has its old text)", async () => {
    const code = "if a {\n    return 1\n}\nif b {\n    return 1\n}";
    const { view, replace } = await codeEditor(code);
    // Caret at the end of the first « return 1 » (line 2).
    const caret = code.indexOf("return 1") + "return 1".length;
    view.dispatch({ selection: { anchor: caret } });
    replace(code.replace("return 1", "return 2"));
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    expect(line.number).toBe(2);
  });

  it("the caret stays on a blank line where the other device wrote", async () => {
    const code = "fn a() {}\n\nfn b() {}\n\nfn c() {}";
    const { view, replace } = await codeEditor(code);
    view.dispatch({ selection: { anchor: 10 } }); // the first blank line (line 2)
    replace("fn a() {}\n// note\nfn b() {}\n\nfn c() {}");
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    expect(line.number).toBe(2);
  });

  it("a stored text with CRLF line ends does not throw", async () => {
    const { view, replace } = await codeEditor("c\nzzz");
    view.dispatch({ selection: { anchor: 1 } });
    expect(() => replace("p\r\nq\r\nc")).not.toThrow();
    expect(view.state.doc.toString()).toBe("p\nq\nc");
  });
});

describe("rich editor: a paragraph edited elsewhere while the caret is in it", () => {
  it("the caret stays in that list item (another item has its old text)", async () => {
    const { editor, replace } = await richEditor("- Lait\n- Pain\n- Lait");
    editor.commands.focus();
    caretAfter(editor, "La", 0);
    replace("- Lait bio\n- Pain\n- Lait");
    expect(editor.getText({ blockSeparator: "|" }).replace(/\|+/g, "|")).toBe("|Lait bio|Pain|Lait|");
    // index(1): the list item the caret is in (0 = the one edited elsewhere).
    expect(editor.state.selection.$from.index(1)).toBe(0);
    expect(editor.state.selection.$from.parent.textContent).toBe("Lait bio");
  });

  it("a caret in TipTap's trailing paragraph stays there", async () => {
    const { editor, replace } = await richEditor("Lait\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    editor.commands.focus("end");
    // Clicked below the table: the caret in TipTap's empty trailing paragraph.
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)),
    );
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.depth).toBe(1);
    replace("Pain\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    // Still below the table, not in its last cell.
    expect(editor.state.selection.$from.depth).toBe(1);
  });

  it("a selected word in a list ending the note stays selected", async () => {
    const { editor, replace } = await richEditor("Lait\n\n- œufs frais\n- sel");
    editor.commands.focus();
    const from = (() => {
      let p = -1;
      editor.state.doc.descendants((n, pos) => {
        if (p < 0 && n.isText && n.text!.includes("frais")) p = pos + n.text!.indexOf("frais");
      });
      return p;
    })();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + 5)));
    replace("Pain\n\n- œufs frais\n- sel");
    const { from: a, to: b } = editor.state.selection;
    expect(editor.state.doc.textBetween(a, b)).toBe("frais");
  });
});

describe("followCaretInDocument units", () => {
  const editors: Editor[] = [];
  afterEach(() => editors.splice(0).forEach((e) => e.destroy()));
  const doc = (markdown: string) => {
    const editor = new Editor({ extensions: createRichExtensions(), content: markdown, contentType: "markdown" });
    editors.push(editor);
    return editor.state.doc;
  };
  it("a hard break counts as a position, not as text", () => {
    const before = doc("ab  \ncd"); // ab<br>cd
    const caret = 1 + 4; // after « c »
    const after = doc("Avant\n\nabcd\n\nFin");
    const target = followCaretInDocument(before, caret, after, after.content.size, {
      from: 0,
      to: before.content.size,
      toNew: after.content.size,
    });
    const $t = after.resolve(target);
    // Either left alone, or right after « c ».
    expect([after.content.size, $t.start() + 3]).toContain(target);
  });
});
