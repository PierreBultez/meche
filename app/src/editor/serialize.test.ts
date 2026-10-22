import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createRichExtensions } from "./extensions";
import { serializeMarkdown } from "./serialize";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function open(markdown: string): Editor {
  editor = new Editor({ extensions: createRichExtensions(), content: markdown, contentType: "markdown" });
  return editor;
}

describe("serializeMarkdown", () => {
  it.each(["Texte", "- [ ] Lait", "```js\nlet a;\n```", "| Article | Prix   |\n| ------- | ------ |\n| Lait    | 1,20 € |"])(
    "an untouched note saves exactly as it was: %j",
    (markdown) => {
      const opened = open(markdown);
      // Any transaction (a click, a focus…) lets TipTap append its trailing empty paragraph.
      opened.view.dispatch(opened.state.tr);
      expect(opened.state.doc.lastChild?.type.name).toBe("paragraph");
      expect(serializeMarkdown(opened)).toBe(markdown);
    },
  );

  it("keeps an empty note empty", () => {
    const opened = open("");
    opened.view.dispatch(opened.state.tr);
    expect(serializeMarkdown(opened)).toBe("");
  });
});
