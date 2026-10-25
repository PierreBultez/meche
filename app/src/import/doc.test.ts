import type { JSONContent } from "@tiptap/core";
import { afterAll, describe, expect, it } from "vitest";
import { cleanDoc, doc, hardBreak, paragraph, safeHref, text } from "./doc";
import { MarkdownWriter } from "./markdown-writer";

const writer = new MarkdownWriter();
afterAll(() => writer.destroy());

const clean = (content: JSONContent[], collapseSpaces = true) => cleanDoc(doc(content), { collapseSpaces });
const written = (content: JSONContent[], collapseSpaces = true) => {
  const cleaned = clean(content, collapseSpaces);
  return writer.write(cleaned, writer.schema.nodeFromJSON(cleaned).textContent);
};
const bold = [{ type: "bold" }];

describe("cleanDoc", () => {
  it("moves spaces out of bold, italic… so that they read back as such", () => {
    expect(written([paragraph([text("a"), text(" b ", bold), text("c")])])).toEqual({ markdown: "a **b** c", exact: true });
  });

  it("keeps inline code alone, a link before it", () => {
    const link = { type: "link", attrs: { href: "https://example.com" } };
    expect(written([paragraph([text("x", [{ type: "bold" }, { type: "code" }]), text(" "), text("y", [{ type: "code" }, link])])]).markdown).toBe(
      "`x` [y](https://example.com)",
    );
  });

  it("drops marks Markdown has not, and unsafe links", () => {
    const marks = [{ type: "underline" }, { type: "highlight" }, { type: "link", attrs: { href: "javascript:x" } }];
    expect(clean([paragraph([text("a", marks)])])).toEqual(doc([paragraph([text("a")])]));
  });

  it("removes line breaks at the edges, and spaces before a break", () => {
    expect(written([paragraph([hardBreak(), text("a  "), hardBreak(), text("  b"), hardBreak()])]).markdown).toBe("a  \nb");
    // Typed text keeps the spaces starting a line: an indentation.
    expect(written([paragraph([text("a"), hardBreak(), text("  b")])], false).markdown).toBe("a  \n&#32; b");
  });

  it("collapses spaces of HTML only", () => {
    expect(written([paragraph([text("a   b")])]).markdown).toBe("a b");
    expect(written([paragraph([text("a   b")])], false).markdown).toBe("a   b");
  });

  it("drops an empty document down to one empty paragraph", () => {
    expect(clean([paragraph([text("  ")]), { type: "bulletList", content: [] }])).toEqual(doc([paragraph()]));
    expect(written([]).markdown).toBe("");
  });

  it("gives a list item a text before its sub-list, and drops empty items", () => {
    const sub = { type: "bulletList", content: [{ type: "listItem", content: [paragraph([text("b")])] }] };
    const list = { type: "bulletList", content: [{ type: "listItem", content: [sub] }, { type: "listItem", content: [paragraph()] }] };
    expect(written([list])).toEqual({ markdown: "-\n  - b", exact: true });
  });

  it("brings headings to levels 1 to 3", () => {
    expect(written([{ type: "heading", attrs: { level: 6 }, content: [text("a")] }]).markdown).toBe("### a");
  });

  it("drops empty code blocks and the blank lines around code", () => {
    const code = (value: string, language: string | null) => ({ type: "codeBlock", attrs: { language }, content: value ? [text(value)] : [] });
    expect(written([code("", "php"), code("\n\necho 1;\n\n", "PHP"), code("x", "klingon")]).markdown).toBe("```php\necho 1;\n```\n\n```\nx\n```");
  });
});

describe("safeHref", () => {
  it.each([
    ["https://example.com", "https://example.com"],
    [" HTTP://example.com ", "HTTP://example.com"],
    ["mailto:a@example.com", "mailto:a@example.com"],
    ["javascript:alert(1)", null],
    ["file:///etc/passwd", null],
    ["data:text/html,x", null],
    ["/relatif", null],
    [42, null],
  ])("%j → %j", (href, expected) => {
    expect(safeHref(href)).toBe(expected);
  });
});
