/**
 * Markdown round trip of rich notes (docs/05, "Aller-retour stable obligatoire"):
 * opening a note and saving it untouched must give back exactly the same Markdown,
 * otherwise every opening would mark the note as modified and trigger a sync.
 */
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { marked } from "marked";
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

describe("what the editor writes reads back the same (phase 1 review)", () => {
  const text = (value: string, marks?: JSONContent["marks"]): JSONContent =>
    marks ? { type: "text", text: value, marks } : { type: "text", text: value };
  const paragraph = (...content: JSONContent[]): JSONContent =>
    content.length ? { type: "paragraph", content } : { type: "paragraph" };
  const hardBreak: JSONContent = { type: "hardBreak" };
  const link = (value: string, href: string) => text(value, [{ type: "link", attrs: { href } }]);
  const item = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
  const cell = (type: "tableCell" | "tableHeader", value: string): JSONContent => ({
    type,
    content: [paragraph(text(value))],
  });

  it.each<[string, JSONContent[]]>([
    ["a lone dash", [paragraph(text("-"))]],
    ["a lone plus", [paragraph(text("+"))]],
    ["four leading spaces", [paragraph(text("    indenté"))]],
    ["two leading spaces", [paragraph(text("  deux espaces"))]],
    ["a leading tab", [paragraph(text("\tune tabulation"))]],
    ["a signature", [paragraph(text("Merci"), hardBreak, text("--"), hardBreak, text("Pierre"))]],
    ["a short setext underline", [paragraph(text("Titre"), hardBreak, text("="))]],
    ["a bare URL", [paragraph(text("Doc : https://example.com"))]],
    ["a www address", [paragraph(text("Voir www.example.com"))]],
    ["an e-mail address", [paragraph(text("Écrire à pierre@example.com"))]],
    ["a link with a space", [paragraph(link("fichier", "https://example.com/Mon fichier.pdf"))]],
    ["a link with a parenthesis", [paragraph(link("page", "https://x.y/a)b"))]],
    [
      "an empty ordered item",
      [{ type: "orderedList", content: [item(paragraph(text("Lait"))), item(paragraph()), item(paragraph(text("Pain")))] }],
    ],
    [
      "an empty last ordered item",
      [{ type: "orderedList", content: [item(paragraph(text("Lait"))), item(paragraph())] }],
    ],
    [
      "list markers in a table cell",
      [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("tableHeader", "Article"), cell("tableHeader", "Prix")] },
            { type: "tableRow", content: [cell("tableCell", "- Lait"), cell("tableCell", "1. Pain")] },
          ],
        },
      ],
    ],
  ])("%s", (_case, content) => {
    const typed: JSONContent = { type: "doc", content };
    const saved = editorFor(typed).getMarkdown();
    const reopened = editorFor(saved);
    expect(reopened.getJSON()).toEqual(editorFor(typed).getJSON());
    expect(reopened.getMarkdown()).toBe(saved);
  });

  it("only allows paragraphs in table cells (GFM keeps a cell on one line)", () => {
    const schema = editorFor("").schema;
    expect(schema.nodes.tableCell.spec.content).toBe("paragraph+");
    expect(schema.nodes.tableHeader.spec.content).toBe("paragraph+");
  });

  it("does not pile up parser extensions from one editor to the next", () => {
    const first = editorFor("- [ ] a").getMarkdown();
    for (let index = 0; index < 20; index++) editorFor("- [ ] a");
    expect(editorFor("- [ ] a").getMarkdown()).toBe(first);
    // The shared default parser is left untouched.
    expect(marked.defaults.extensions).toBeNull();
  });
});
