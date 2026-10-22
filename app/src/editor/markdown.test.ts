/**
 * Markdown round trip of rich notes (docs/05, "Aller-retour stable obligatoire"):
 * opening a note and saving it untouched must give back exactly the same Markdown,
 * otherwise every opening would mark the note as modified and trigger a sync.
 */
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createRichExtensions } from "./extensions";

const fixtures = import.meta.glob<string>("./__fixtures__/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

function editorFor(content: string | JSONContent): Editor {
  const editor = new Editor({
    extensions: createRichExtensions(),
    content,
    contentType: typeof content === "string" ? "markdown" : "json",
  });
  editors.push(editor);
  return editor;
}

/** What the editor saves after opening `markdown` and changing nothing. */
const roundTrip = (markdown: string) => editorFor(markdown).getMarkdown();

describe("Markdown produced by the editor survives a round trip unchanged", () => {
  it("has fixtures", () => {
    expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(10);
  });

  it.each(Object.entries(fixtures))("%s", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe("hand-written Markdown is normalized once, then stays stable", () => {
  it.each([
    ["uppercase task box", "- [X] Fait"],
    ["bare link", "Voir https://example.com"],
    ["unaligned table", "| a | b |\n|---|---|\n| 1 | 2 |"],
    ["underscore emphasis", "Du _texte_ en __gras__"],
    ["asterisk list", "* un\n* deux"],
    ["windows path", "C:\\Users\\pierre"],
    ["loose list", "- un\n\n- deux"],
    ["fence with tildes", "~~~js\nconst a = 1;\n~~~"],
  ])("%s", (_case, input) => {
    const once = roundTrip(input);
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps checked boxes checked whatever the case", () => {
    expect(roundTrip("- [X] Fait\n- [x] Aussi")).toBe("- [x] Fait\n- [x] Aussi");
  });
});

describe("text that looks like Markdown stays text", () => {
  const paragraphs = [
    "1. pas une liste",
    "- pas une puce",
    "# pas un titre",
    "> pas une citation",
    "[ ] pas une case",
    "```js",
    "---",
    'Balise <div class="x"> et a < b > c & d',
  ];

  it.each(paragraphs)("%j", (text) => {
    const typed: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    };
    const saved = editorFor(typed).getMarkdown();
    const reopened = editorFor(saved).getJSON();
    expect(reopened).toEqual(editorFor(typed).getJSON());
    expect(roundTrip(saved)).toBe(saved);
  });
});
