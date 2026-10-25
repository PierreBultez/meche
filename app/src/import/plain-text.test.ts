import { afterAll, describe, expect, it } from "vitest";
import { cleanDoc } from "./doc";
import { MarkdownWriter } from "./markdown-writer";
import { plainTextToDoc } from "./plain-text";

const writer = new MarkdownWriter();
afterAll(() => writer.destroy());

/** The text the editor shows after opening the imported note: paragraphs separated by an empty
 * line, line breaks as line breaks. */
function shownText(markdown: string): string {
  const node = writer.schema.nodeFromJSON(writer.read(markdown));
  return node.textBetween(0, node.content.size, "\n\n", "\n");
}

function imported(source: string) {
  return writer.write(cleanDoc(plainTextToDoc(source), { collapseSpaces: false }), source);
}

describe("plain text", () => {
  // Text a plain text note may hold, that Markdown would otherwise read as something else.
  const tricky = [
    "a*b*c _d_ __e__ ~~f~~ `g` \\h [i](j) ![k](l) <m> &n; &amp; |o|",
    "# pas un titre\n## ni celui-ci",
    "- pas une puce\n+ ni celle-ci\n* ni celle-là",
    "1. pas une liste\n2) non plus\nM. Dupont",
    "> pas une citation\n>> ni celle-ci",
    "```js\npas du code\n```",
    "---\n***\n___\n- - -\n-- ------ ----",
    "Titre\n===\nSous-titre\n---",
    "| a | b |\n|---|---|\n| 1 | 2 |",
    "Titre\n|---\nTitre\n:---\nTitre\n---|\nTitre\n:-:",
    "    quatre espaces\n\tune tabulation\n  deux espaces",
    "<script>alert(1)</script> <b>gras ?</b> <!-- commentaire -->",
    "C:\\Users\\pierre\\Documents",
    "https://example.com/a_b_c et mail@example.com",
    "- [ ] pas une case\n[x] ni celle-ci",
    "Ligne finie par une barre \\\nsuite",
    "&nbsp; &#32; &lt; écrits tels quels",
  ];

  it.each(tricky)("%j stays exactly the typed text", (source) => {
    const { markdown, exact } = imported(source);
    expect(exact).toBe(true);
    expect(shownText(markdown)).toBe(source);
  });

  it("separates paragraphs at empty lines, and drops spaces at the end of lines", () => {
    const { markdown } = imported("a  \r\nb\n\n\n   \nc");
    expect(markdown).toBe("a  \nb\n\nc");
    expect(shownText(markdown)).toBe("a\nb\n\nc");
  });

  it("gives an empty note for an empty text", () => {
    expect(imported("\n\n  \n").markdown).toBe("");
  });
});
