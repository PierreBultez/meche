import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createRichExtensions } from "./extensions";
import { followCaretInDocument, followCaretInText } from "./follow-caret";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function documentOf(markdown: string) {
  const editor = new Editor({ extensions: createRichExtensions(), content: markdown, contentType: "markdown" });
  editors.push(editor);
  return editor.state.doc;
}

describe("the caret after another version is shown (rich editor)", () => {
  it("goes back to its paragraph when the change covers it", () => {
    const before = documentOf("Intro");
    const after = documentOf("Avant\n\nIntro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    // After « Intro »; the mapping put it at the end of the change (in the table).
    const caret = 6;
    const target = followCaretInDocument(before, caret, after, after.content.size - 3);
    const $target = after.resolve(target);
    expect($target.parent.textContent).toBe("Intro");
    expect($target.parentOffset).toBe(5);
  });

  it("keeps the mapped place when it is already in the same paragraph", () => {
    const before = documentOf("Intro");
    const after = documentOf("Avant\n\nIntro");
    expect(followCaretInDocument(before, 6, after, 13)).toBe(13);
  });

  it("keeps the mapped place when its paragraph changed", () => {
    const before = documentOf("Intro");
    const after = documentOf("Introduction");
    expect(followCaretInDocument(before, 6, after, 6)).toBe(6);
  });

  it("picks the nearest of identical paragraphs", () => {
    const before = documentOf("Lait\n\nPain\n\nLait");
    const after = documentOf("Début\n\nLait\n\nPain\n\nLait\n\nFin");
    // In the second « Lait » (third block), after « La ».
    const caret = before.resolve(13).start() + 2;
    const target = followCaretInDocument(before, caret, after, after.content.size);
    expect(after.resolve(target).index(0)).toBe(3);
    expect(after.resolve(target).parentOffset).toBe(2);
  });
});

describe("the caret after another version is shown (code editor)", () => {
  it("goes back to its line when the change covers it", () => {
    const after = "avant\nmake test\naprès";
    // After « make » in « make test », mapped to the end.
    expect(followCaretInText("make test", 4, after, after.length)).toBe(6 + 4);
  });

  it("keeps the mapped place when it is already on the same line", () => {
    expect(followCaretInText("a\nb", 3, "x\na\nb", 5)).toBe(5);
  });

  it("keeps the mapped place when its line changed", () => {
    expect(followCaretInText("make", 4, "make test", 4)).toBe(4);
  });
});
