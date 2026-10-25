import type { JSONContent } from "@tiptap/core";
import { afterAll, describe, expect, it } from "vitest";
import { cleanDoc } from "./doc";
import { lexicalText, lexicalToDoc } from "./lexical";
import { MarkdownWriter } from "./markdown-writer";
import type { ImportWarning } from "./types";

const writer = new MarkdownWriter();
afterAll(() => writer.destroy());

const t = (text: string, format = 0) => ({ type: "text", text, format });
const p = (...children: object[]) => ({ type: "paragraph", children });
const item = (children: object[], extra: object = {}) => ({ type: "listitem", children, ...extra });
const list = (listType: string, ...children: object[]) => ({ type: "list", listType, children });
const state = (...children: object[]) => JSON.stringify({ root: { type: "root", children } });

/** The Markdown of a Lexical state, and the warnings of its conversion. */
function convert(json: string): { markdown: string; exact: boolean; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const doc: JSONContent = cleanDoc(lexicalToDoc(json, warnings), { collapseSpaces: false });
  return { ...writer.write(doc, lexicalText(json)), warnings };
}

describe("lexicalToDoc", () => {
  it("writes each text format, and drops those Markdown has not", () => {
    // 1 bold, 2 italic, 4 strikethrough, 8 underline, 16 code, 32 subscript, 128 highlight.
    const json = state(p(t("g", 1), t(" "), t("i", 2), t(" "), t("b", 4), t(" "), t("s", 8), t(" "), t("c", 16), t(" "), t("x", 32 + 128), t(" "), t("gi", 3)));
    expect(convert(json).markdown).toBe("**g** *i* ~~b~~ s `c` x ***gi***");
  });

  it("attaches a nested list to the item above it", () => {
    const json = state(
      list(
        "bullet",
        item([t("Fruits")]),
        item([list("bullet", item([t("Pommes")]), item([list("bullet", item([t("Golden")]))]))]),
        item([t("Légumes")]),
      ),
    );
    expect(convert(json)).toMatchObject({ markdown: "- Fruits\n  - Pommes\n    - Golden\n- Légumes", exact: true });
  });

  it("gives an empty text to a nested list with no item above it", () => {
    const json = state(list("number", item([list("number", item([t("Seul")]))])));
    expect(convert(json)).toMatchObject({ markdown: "1.\n   1. Seul", exact: true });
  });

  it("keeps the number a list starts at", () => {
    const json = JSON.stringify({ root: { type: "root", children: [{ ...list("number", item([t("quatre")])), start: 4 }] } });
    expect(convert(json)).toMatchObject({ markdown: "4. quatre", exact: true });
  });

  it("skips what is not a node among the children", () => {
    const json = state(p(t("a"), null as unknown as object, 3 as unknown as object, t("b")), null as unknown as object);
    expect(convert(json)).toMatchObject({ markdown: "ab", exact: true });
  });

  it("reads checked boxes, a missing `checked` being a box to do", () => {
    const json = state(list("check", item([t("Fait")], { checked: true }), item([t("À faire")], { checked: false }), item([t("Aussi")])));
    expect(convert(json).markdown).toBe("- [x] Fait\n- [ ] À faire\n- [ ] Aussi");
  });

  it("drops empty paragraphs and items, used as spacing", () => {
    const json = state(p(t("a")), p(), p(t(" ")), list("bullet", item([]), item([t("b")])), p(t("c")));
    expect(convert(json).markdown).toBe("a\n\n- b\n\nc");
  });

  it("brings headings to levels 1 to 3, on one line", () => {
    const json = state(
      { type: "heading", tag: "h1", children: [t("Un"), { type: "linebreak" }, t("titre")] },
      { type: "heading", tag: "h5", children: [t("Petit")] },
    );
    expect(convert(json).markdown).toBe("# Un titre\n\n### Petit");
  });

  it("keeps the spaces typed in a row, not the no-break ones", () => {
    expect(convert(state(p(t("a    b  c")))).markdown).toBe("a    b  c");
  });

  it("writes code blocks with their language and lines", () => {
    const json = state({
      type: "code",
      language: "php",
      children: [{ type: "code-highlight", text: "echo 1;" }, { type: "linebreak" }, { type: "tab" }, { type: "code-highlight", text: "return;" }],
    });
    expect(convert(json).markdown).toBe("```php\necho 1;\n\treturn;\n```");
  });

  it("gives a table without header (as Lexical makes them) its first row as header", () => {
    const cell = (text: string) => ({ type: "tablecell", headerState: 0, children: [p(t(text))] });
    const json = state({ type: "table", children: [{ type: "tablerow", children: [cell("a"), cell("b")] }, { type: "tablerow", children: [cell("1")] }] });
    expect(convert(json)).toMatchObject({ markdown: "| a   | b   |\n| --- | --- |\n| 1   |     |", exact: true });
  });

  it("keeps web and e-mail links only", () => {
    const link = (url: string, text: string) => ({ type: "link", url, children: [t(text)] });
    const json = state(p(link("https://example.com", "site"), t(" "), link("mailto:a@example.com", "écrire"), t(" "), link("file:///etc/passwd", "fichier")));
    expect(convert(json).markdown).toBe("[site](https://example.com) [écrire](mailto:a@example.com) fichier");
  });

  it("keeps the text of unknown blocks and reports what had none", () => {
    const json = state(
      { type: "collapsible-container", children: [{ type: "collapsible-title", children: [t("Titre")] }, { type: "collapsible-content", children: [p(t("Dedans"))] }] },
      { type: "snfile", fileUuid: "x" },
      p(t("a "), { type: "inline-image", src: "x.png" }, t("b")),
    );
    const { markdown, warnings, exact } = convert(json);
    expect(markdown).toBe("Titre\n\nDedans\n\na b");
    expect(exact).toBe(true);
    expect(warnings.map((warning) => warning.detail)).toEqual(["layout", "layout", "layout", "snfile", "inline-image"]);
  });

  it("refuses what is not a Lexical state", () => {
    for (const json of ["pas du JSON", "{}", '{"root":{"type":"paragraph"}}', "null"]) {
      expect(() => lexicalToDoc(json, [])).toThrow();
    }
  });
});
