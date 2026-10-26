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
    ["a line under a sub-list, not indented enough", "- Courses\n  - [ ] Lait\n  entier"],
    ["a code block after a blank line in a numbered item", "1. a\n\n   ```\n   code\n     plus loin\n   ```"],
    ["two spaces after a number", "1.  a\n    - [ ] b\n    - [ ] c"],
  ])("%s", (_case, input) => {
    const editor = editorFor(input);
    // A document the schema refuses would be dropped on the next save.
    expect(() => editor.schema.nodeFromJSON(editor.getJSON()).check()).not.toThrow();
    const once = editor.getMarkdown();
    expect(roundTrip(once)).toBe(once);
  });

  it("opens an empty first item written with a space, as before phase 4", () => {
    const list = (type: string, ...texts: string[]): JSONContent => ({
      type: "doc",
      content: [
        {
          type,
          content: texts.map((value) => ({
            type: "listItem",
            content: [value ? { type: "paragraph", content: [{ type: "text", text: value }] } : { type: "paragraph" }],
          })),
        },
      ],
    });
    expect(editorFor("1. \n2. b").getJSON()).toEqual(editorFor(list("orderedList", "", "b")).getJSON());
    expect(editorFor("- \n- b").getJSON()).toEqual(editorFor(list("bulletList", "", "b")).getJSON());
    expect(editorFor("1. ").getJSON()).toEqual(editorFor(list("orderedList", "")).getJSON());
  });

  it("keeps the code of a numbered item as typed", () => {
    expect(roundTrip("1. a\n\n   ```\n   code\n     plus loin\n   ```")).toBe("1. a\n   ```\n   code\n     plus loin\n   ```");
    expect(roundTrip("1.  a\n    - [ ] b\n    - [ ] c")).toBe("1. a\n   - [ ] b\n   - [ ] c");
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
    "-- ------ ----",
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
  const task = (checked: boolean, ...content: JSONContent[]): JSONContent => ({
    type: "taskItem",
    attrs: { checked },
    content,
  });
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
    ["« M. » at the start", [paragraph(text("M. Dupont viendra"))]],
    ["« Cf. » at the start", [paragraph(text("Cf. le document"))]],
    ["« a) » at the start", [paragraph(text("a) option"))]],
    ["a roman numeral", [paragraph(text("IV. Chapitre"))]],
    ["a long number", [paragraph(text("0612345678. Appeler"))]],
    [
      "« M. » right after a numbered list",
      [{ type: "orderedList", content: [item(paragraph(text("Lait")))] }, paragraph(text("M. Dupont"))],
    ],
    [
      "an emptied numbered item with sub-items",
      [
        {
          type: "orderedList",
          content: [
            item(paragraph(text("Avant"))),
            item(paragraph(), { type: "orderedList", content: [item(paragraph(text("Lait")))] }),
            item(paragraph(text("Après"))),
          ],
        },
      ],
    ],
    [
      "an emptied bullet with sub-items",
      [
        {
          type: "bulletList",
          content: [
            item(paragraph(text("Lait"))),
            item(paragraph(), { type: "bulletList", content: [item(paragraph(text("sous")))] }),
            item(paragraph(text("Pain"))),
          ],
        },
      ],
    ],
    ["two line breaks in a row", [paragraph(text("a"), hardBreak, hardBreak, text("b"))]],
    ["a line of spaces between two breaks", [paragraph(text("a"), hardBreak, text(" "), hardBreak, text("b"))]],
    ["a paragraph of two spaces", [paragraph(text("  "))]],
    ["two spaces after a break", [paragraph(text("a"), hardBreak, text("  "))]],
    [
      "an emptied first sub-item under a bullet",
      [
        {
          type: "bulletList",
          content: [
            item(
              paragraph(text("Courses")),
              { type: "bulletList", content: [item(paragraph(), { type: "bulletList", content: [item(paragraph(text("pommes")))] })] },
            ),
          ],
        },
      ],
    ],
    [
      "an emptied first sub-item under a numbered item",
      [
        {
          type: "orderedList",
          content: [
            item(
              paragraph(text("a")),
              { type: "bulletList", content: [item(paragraph(), { type: "bulletList", content: [item(paragraph(text("s")))] })] },
            ),
          ],
        },
      ],
    ],
    [
      "an emptied first sub-item in a quote",
      [
        {
          type: "blockquote",
          content: [
            {
              type: "bulletList",
              content: [
                item(
                  paragraph(text("a")),
                  { type: "bulletList", content: [item(paragraph(), { type: "bulletList", content: [item(paragraph(text("s")))] })] },
                ),
              ],
            },
          ],
        },
      ],
    ],
    ["three line breaks in a row", [paragraph(text("a"), hardBreak, hardBreak, hardBreak, text("b"))]],
    [
      "lines that look like a table",
      [paragraph(text("| a | b |"), hardBreak, text("|---|---|"), hardBreak, text("| 1 | 2 |"))],
    ],
    ["a table delimiter without pipes at the ends", [paragraph(text("a | b"), hardBreak, text("--- | ---"))]],
    [
      "a line break in a task item",
      [
        {
          type: "taskList",
          content: [
            task(false, paragraph(text("Lait"), hardBreak, text("demi-écrémé"), hardBreak, text("- bio"))),
            task(true, paragraph(text("Pain"))),
          ],
        },
      ],
    ],
    [
      "a line break in a nested task item",
      [
        {
          type: "taskList",
          content: [
            task(
              false,
              paragraph(text("Courses")),
              { type: "taskList", content: [task(true, paragraph(text("Lait"), hardBreak, text("entier")))] },
            ),
          ],
        },
      ],
    ],
    [
      "a task item with a line break and sub-items",
      [
        {
          type: "taskList",
          content: [
            task(
              false,
              paragraph(text("Valise"), hardBreak, text("la grande")),
              { type: "taskList", content: [task(false, paragraph(text("Pulls")))] },
            ),
          ],
        },
      ],
    ],
    [
      "a line break in a task item under a bullet",
      [
        {
          type: "bulletList",
          content: [
            item(
              paragraph(text("Courses")),
              { type: "taskList", content: [task(false, paragraph(text("Lait"), hardBreak, text("entier"))), task(true, paragraph(text("Pain")))] },
            ),
          ],
        },
      ],
    ],
    [
      "a line break in a task item under a numbered item",
      [
        {
          type: "orderedList",
          content: [
            item(
              paragraph(text("Courses")),
              { type: "taskList", content: [task(false, paragraph(text("Lait"), hardBreak, text("entier")))] },
            ),
          ],
        },
      ],
    ],
    [
      "a line break in a task item under a quote",
      [{ type: "blockquote", content: [{ type: "taskList", content: [task(false, paragraph(text("Lait"), hardBreak, text("entier")))] }] }],
    ],
    [
      "spaces after a line break in a task item",
      [{ type: "taskList", content: [task(false, paragraph(text("Lait"), hardBreak, text("  entier")))] }],
    ],
    [
      "a link and bold after a line break in a task item",
      [
        {
          type: "taskList",
          content: [
            task(
              false,
              paragraph(
                text("Lait"),
                hardBreak,
                text("voir "),
                link("ici", "https://example.com"),
                text(" et "),
                text("gras", [{ type: "bold" }]),
              ),
            ),
          ],
        },
      ],
    ],
    [
      "a horizontal rule right under the text of an item",
      [
        { type: "bulletList", content: [item(paragraph(text("a")), { type: "horizontalRule" }, paragraph(text("b")))] },
        { type: "orderedList", content: [item(paragraph(text("c")), { type: "horizontalRule" })] },
      ],
    ],
    [
      "code under a numbered item",
      [
        {
          type: "orderedList",
          content: [
            item(paragraph(text("Installer")), {
              type: "codeBlock",
              attrs: { language: "bash" },
              content: [text("npm ci\n  --quiet")],
            }),
            item(paragraph(text("Lancer"))),
          ],
        },
      ],
    ],
    [
      "a checklist under a numbered item",
      [
        {
          type: "orderedList",
          content: [
            item(paragraph(text("Courses")), { type: "taskList", content: [task(false, paragraph(text("Lait"))), task(true, paragraph(text("Pain")))] }),
          ],
        },
      ],
    ],
    [
      "a checklist under item 10",
      [
        {
          type: "orderedList",
          attrs: { start: 10 },
          content: [item(paragraph(text("Dix")), { type: "taskList", content: [task(false, paragraph(text("a"))), task(false, paragraph(text("b")))] })],
        },
      ],
    ],
    [
      "two paragraphs in a numbered item",
      [{ type: "orderedList", content: [item(paragraph(text("a")), paragraph(text("b"), hardBreak, text("c")))] }],
    ],
    // Round 2 of the phase 4 reviews: Markdown read back as raw text inside list items.
    [
      "a formatted paragraph after a checklist in a bullet item",
      [
        {
          type: "bulletList",
          content: [
            item(
              paragraph(text("Courses")),
              { type: "taskList", content: [task(false, paragraph(text("Lait")))] },
              paragraph(text("Voir "), link("ici", "https://example.com"), text(" "), text("vite", [{ type: "bold" }]), text(" a < b * c")),
            ),
          ],
        },
      ],
    ],
    [
      "formatting after a line break in a task item under a bullet",
      [
        {
          type: "bulletList",
          content: [
            item(
              paragraph(text("Courses")),
              { type: "taskList", content: [task(false, paragraph(text("Lait"), hardBreak, text("bio", [{ type: "bold" }]), text(" < 2 €")))] },
            ),
          ],
        },
      ],
    ],
    [
      "a code block and paragraphs in a task item under a bullet",
      [
        {
          type: "bulletList",
          content: [
            item(
              paragraph(text("Courses")),
              {
                type: "taskList",
                content: [
                  task(
                    false,
                    paragraph(text("Lait")),
                    { type: "codeBlock", attrs: { language: null }, content: [text("code")] },
                    paragraph(text("Voir "), text("ici", [{ type: "bold" }])),
                    paragraph(text("b")),
                  ),
                ],
              },
            ),
          ],
        },
      ],
    ],
    [
      "a paragraph after a heading in a bullet item",
      [{ type: "bulletList", content: [item(paragraph(text("a")), { type: "heading", attrs: { level: 3 }, content: [text("titre")] }, paragraph(text("x", [{ type: "bold" }])))] }],
    ],
    // TipTap's own reader of numbered lists misread the editor's output (already before phase 4).
    [
      "code with numbered lines in a numbered item",
      [
        {
          type: "orderedList",
          content: [
            item(paragraph(text("Installer")), { type: "codeBlock", attrs: { language: null }, content: [text("1. npm ci\n2. npm run build\na) x\n  10. y")] }),
            item(paragraph(text("Lancer"))),
          ],
        },
      ],
    ],
    [
      "a table in a numbered item",
      [
        {
          type: "orderedList",
          content: [
            item(paragraph(text("a")), {
              type: "table",
              content: [
                { type: "tableRow", content: [cell("tableHeader", "h1"), cell("tableHeader", "h2")] },
                { type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "2")] },
              ],
            }),
          ],
        },
      ],
    ],
    [
      "a code block after a nested numbered list",
      [
        {
          type: "orderedList",
          content: [
            item(
              paragraph(text("Étape")),
              { type: "orderedList", content: [item(paragraph(text("sous-étape")))] },
              { type: "codeBlock", attrs: { language: null }, content: [text("code")] },
            ),
          ],
        },
      ],
    ],
    [
      "a numbered list under a bullet under a numbered item",
      [
        {
          type: "orderedList",
          content: [
            item(paragraph(text("a")), {
              type: "bulletList",
              content: [item(paragraph(text("b")), { type: "orderedList", content: [item(paragraph(text("c")))] })],
            }),
          ],
        },
      ],
    ],
    [
      "code lines made of spaces in a numbered item",
      [{ type: "orderedList", content: [item(paragraph(text("a")), { type: "codeBlock", attrs: { language: null }, content: [text("x\n   \ny")] })] }],
    ],
    [
      "a hashtag around a line break in list items",
      [
        { type: "bulletList", content: [item(paragraph(text("#courses"), hardBreak, text("lait, pain"))), item(paragraph(text("Idée"), hardBreak, text("#projet")))] },
        { type: "orderedList", content: [item(paragraph(text("Idée"), hardBreak, text("#projet"))), item(paragraph(text("autre")))] },
      ],
    ],
    [
      "a rule after a second paragraph in list items",
      [
        { type: "bulletList", content: [item(paragraph(text("a")), paragraph(text("b")), { type: "horizontalRule" })] },
        { type: "orderedList", content: [item(paragraph(text("c")), paragraph(text("d")), { type: "horizontalRule" })] },
        { type: "taskList", content: [task(false, paragraph(text("e")), { type: "horizontalRule" }), task(true, paragraph(text("f")), paragraph(text("g")), { type: "horizontalRule" })] },
      ],
    ],
    [
      "a sub-item that is just a pipe",
      [{ type: "bulletList", content: [item(paragraph(text("x")), { type: "bulletList", content: [item(paragraph(text("|")))] })] }],
    ],
    // Verification of round 2 (phase 4).
    ["an empty first numbered item", [{ type: "orderedList", content: [item(paragraph()), item(paragraph(text("b")))] }]],
    ["a single empty numbered item", [{ type: "orderedList", content: [item(paragraph())] }]],
    ["an empty first item of a list starting at 5", [{ type: "orderedList", attrs: { start: 5 }, content: [item(paragraph()), item(paragraph(text("b")))] }]],
    ["an empty first bullet", [{ type: "bulletList", content: [item(paragraph()), item(paragraph(text("b")))] }]],
    [
      "an empty first numbered item under a bullet",
      [{ type: "bulletList", content: [item(paragraph(text("a")), { type: "orderedList", content: [item(paragraph()), item(paragraph(text("b")))] })] }],
    ],
    [
      "an empty first sub-item right under the text of an item",
      [
        { type: "orderedList", content: [item(paragraph(text("a")), { type: "bulletList", content: [item(paragraph()), item(paragraph(text("b")))] })] },
        { type: "bulletList", content: [item(paragraph(text("c")), { type: "orderedList", content: [item(paragraph()), item(paragraph(text("d")))] })] },
      ],
    ],
    // (An empty paragraph left at the end of an item has no Markdown: the line typed after the
    // rule is what is kept.)
    [
      "a rule inserted in an empty item (« Séparateur » of the slash menu)",
      [
        { type: "bulletList", content: [item(paragraph(text("a"))), item(paragraph(), { type: "horizontalRule" }, paragraph(text("suite")))] },
        { type: "orderedList", attrs: { start: 10 }, content: [item(paragraph(), { type: "horizontalRule" })] },
      ],
    ],
    [
      "a table after a sub-list in an item",
      [
        {
          type: "bulletList",
          content: [
            item(paragraph(text("a")), { type: "bulletList", content: [item(paragraph(text("x")))] }, {
              type: "table",
              content: [
                { type: "tableRow", content: [cell("tableHeader", "h"), cell("tableHeader", "i")] },
                { type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "2")] },
              ],
            }),
          ],
        },
        {
          type: "orderedList",
          content: [
            item(paragraph(text("b")), { type: "orderedList", content: [item(paragraph(text("y")))] }, {
              type: "table",
              content: [
                { type: "tableRow", content: [cell("tableHeader", "h")] },
                { type: "tableRow", content: [cell("tableCell", "1")] },
              ],
            }),
          ],
        },
      ],
    ],
    ["a line separator in a task", [{ type: "taskList", content: [task(true, paragraph(text("a b c")))] }]],
    [
      "headings ending with « #»",
      [
        { type: "heading", attrs: { level: 2 }, content: [text("Langage C #")] },
        { type: "heading", attrs: { level: 1 }, content: [text("#")] },
        { type: "heading", attrs: { level: 3 }, content: [text("Étape ##")] },
        { type: "heading", attrs: { level: 2 }, content: [text("C#")] },
      ],
    ],
    [
      "two line breaks in a quote",
      [{ type: "blockquote", content: [paragraph(text("a"), hardBreak, hardBreak, text("b"))] }],
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

  it("keeps the Markdown of a cell with several paragraphs", () => {
    // Read back as one paragraph with line breaks: the same Markdown, saved unchanged.
    const saved = editorFor({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("tableHeader", "h")] },
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [paragraph(text("a")), paragraph(), paragraph(text("b"))] }],
            },
          ],
        },
      ],
    }).getMarkdown();
    expect(saved).toContain("a<br><br>b");
    expect(roundTrip(saved)).toBe(saved);
  });

  it("numbers a lettered list (from a paste) with digits, which GFM can store", () => {
    const saved = editorFor({
      type: "doc",
      content: [{ type: "orderedList", attrs: { type: "a" }, content: [item(paragraph(text("premier"))), item(paragraph(text("second")))] }],
    }).getMarkdown();
    expect(saved).toBe("1. premier\n2. second");
    expect(roundTrip(saved)).toBe(saved);
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

describe("a long note is read in a time that grows with its length", () => {
  // Read by the editor at each opening: TipTap's own readers took a time growing with the
  // square of the length (3.6 s for 4,000 short checklists, phase 4 review).
  const blocks: Array<[string, (index: number) => string]> = [
    ["paragraphs", (index) => `ligne ${index}\n\n`],
    ["headings", (index) => `## titre ${index}\n`],
    ["checklists between paragraphs", (index) => `- [x] tâche ${index}\n\ntexte ${index}\n\n`],
    ["checklists separated by blank lines", (index) => `- [ ] tâche ${index}\n\n`],
    ["tables", (index) => `| a | b |\n| --- | --- |\n| ${index} | x |\n\n`],
    ["numbered lists between headings", (index) => `${index + 1}. point\n## titre\n`],
  ];

  it.each(blocks)("%s", (_case, block) => {
    const editor = editorFor("");
    const markdown = Array.from({ length: 8000 }, (_, index) => block(index)).join("");
    const start = performance.now();
    editor.markdown?.parse(markdown);
    // About 0.1 s here; the square of the length would take well over 10 s.
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
