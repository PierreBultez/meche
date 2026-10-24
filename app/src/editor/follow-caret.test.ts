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
    // After « Intro »; the change covers it (from inside « Intro » / « Avant » to the end) and
    // the mapping put it at the end of the change (in the table).
    const caret = 6;
    const replaced = { from: 1, to: before.content.size, toNew: after.content.size };
    const target = followCaretInDocument(before, caret, after, after.content.size - 3, replaced);
    const $target = after.resolve(target);
    expect($target.parent.textContent).toBe("Intro");
    expect($target.parentOffset).toBe(5);
  });

  it("keeps the mapped place when it is already in the same paragraph", () => {
    const before = documentOf("Intro");
    const after = documentOf("Avant\n\nIntro");
    const replaced = { from: 1, to: before.content.size, toNew: after.content.size };
    expect(followCaretInDocument(before, 6, after, 13, replaced)).toBe(13);
  });

  it("keeps the mapped place when its paragraph changed", () => {
    const before = documentOf("Intro");
    const after = documentOf("Introduction");
    // Only « duction » was inserted, at the caret: not covered, the mapping is right.
    expect(followCaretInDocument(before, 6, after, 6, { from: 6, to: 6, toNew: 13 })).toBe(6);
  });

  it("picks the nearest of identical paragraphs", () => {
    const before = documentOf("Lait\n\nPain\n\nLait");
    const after = documentOf("Début\n\nLait\n\nPain\n\nLait\n\nFin");
    // In the second « Lait » (third block), after « La »; the whole document changed.
    const caret = before.resolve(13).start() + 2;
    const replaced = { from: 0, to: before.content.size, toNew: after.content.size };
    const target = followCaretInDocument(before, caret, after, after.content.size, replaced);
    expect(after.resolve(target).index(0)).toBe(3);
    expect(after.resolve(target).parentOffset).toBe(2);
  });
});

describe("the caret after another version is shown (code editor)", () => {
  it("stays on its own line when that line changed and another line had its old text", () => {
    const before = "if a {\n    return 1\n}\nif b {\n    return 1\n}";
    const after = before.replace("return 1", "return 2");
    // Inside the first « return 1 », before the « 1 »: only « 1 » → « 2 » changed, so the caret
    // is not covered and keeps its mapped place (never sent to the other « return 1 »).
    const caret = before.indexOf("return 1") + 3;
    const from = before.indexOf("1");
    expect(followCaretInText(before, caret, after, caret, { from, to: from + 1, toNew: from + 1 })).toBe(
      caret,
    );
  });

  it("goes back to its line when the change covers it", () => {
    const after = "avant\nmake test\naprès";
    // After « make » in « make test », mapped to the end of the change (the whole text).
    const replaced = { from: 0, to: 9, toNew: after.length };
    expect(followCaretInText("make test", 4, after, after.length, replaced)).toBe(6 + 4);
  });

  it("keeps the mapped place when it is already on the same line", () => {
    // « x⏎ » inserted at the start: the caret is not covered.
    expect(followCaretInText("a\nb", 3, "x\na\nb", 5, { from: 0, to: 0, toNew: 2 })).toBe(5);
  });

  it("keeps the mapped place when its line changed", () => {
    expect(followCaretInText("make", 4, "make test", 4, { from: 4, to: 4, toNew: 9 })).toBe(4);
  });
});
