import { afterAll, describe, expect, it } from "vitest";
import { cleanDoc } from "./doc";
import { htmlToDoc } from "./html";
import { MarkdownWriter } from "./markdown-writer";
import type { ImportWarning } from "./types";

const writer = new MarkdownWriter();
afterAll(() => writer.destroy());

function convert(html: string): { markdown: string; exact: boolean; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const { doc, sourceText } = htmlToDoc(html, writer.schema, warnings);
  return { ...writer.write(cleanDoc(doc, { collapseSpaces: true }), sourceText), warnings };
}

describe("htmlToDoc", () => {
  it("turns pasted Markdown checkboxes into a checklist", () => {
    const html = '<ul><li><input type="checkbox" disabled> <strong>a</strong> b</li><li><p><input type="checkbox" checked> c</p></li></ul>';
    expect(convert(html)).toMatchObject({ markdown: "- [ ] **a** b\n- [x] c", exact: true });
  });

  it("reads the editor's own checklists with their state", () => {
    const html =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"></label><div><p>a</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>b</p></div></li></ul>';
    expect(convert(html).markdown).toBe("- [x] a\n- [ ] b");
  });

  it("keeps a list mixing boxes and bullets as bullets, the boxes as text", () => {
    const html = '<ul><li><input type="checkbox" checked> a</li><li>b</li></ul>';
    expect(convert(html)).toMatchObject({ markdown: "- \\[x\\] a\n- b", exact: true });
  });

  it("brings h4 to h6 to level 3", () => {
    expect(convert("<h4>a</h4><h6>b</h6>").markdown).toBe("### a\n\n### b");
  });

  it("does not take a « b » of normal weight for bold", () => {
    const html = '<b style="font-weight: normal">a</b> <b style="font-weight: 400">b</b> <b>c</b> <span style="font-weight: 700">d</span>';
    expect(convert(html).markdown).toBe("a b **c** **d**");
  });

  it("collapses spaces and no-break spaces the way the page showed them", () => {
    expect(convert("<p>  a&nbsp;&nbsp;&nbsp;b \n c  <br>  d </p>").markdown).toBe("a b c  \nd");
  });

  it("splits a paragraph at an empty line, drops empty ones", () => {
    expect(convert("<p>a<br><br><br>b</p><p><br></p><p>&nbsp;</p><div><div>c</div></div>").markdown).toBe("a\n\nb\n\nc");
  });

  it("reads code blocks: language, highlighting, one element per line", () => {
    const html =
      '<pre><code class="language-sh"><span class="token">ls</span> -la\n<span>cd</span> ~</code></pre>' +
      "<pre><div>un</div><div>deux</div></pre><pre>trois<br>quatre</pre><pre></pre>";
    expect(convert(html)).toMatchObject({
      markdown: "```bash\nls -la\ncd ~\n```\n\n```\nun\ndeux\n```\n\n```\ntrois\nquatre\n```",
      exact: true,
    });
  });

  it("drops buttons, scripts, styles and forms, and reports images", () => {
    const html =
      '<p>a</p><button aria-label="Copier">Copier</button><script>window.__ran = true</script><style>p{}</style>' +
      '<svg><text>x</text></svg><img src="data:image/png;base64,AAAA" onerror="window.__ran = true"><p>b</p>';
    const { markdown, warnings } = convert(html);
    expect(markdown).toBe("a\n\nb");
    expect(warnings).toEqual([{ code: "unsupported", detail: "img" }]);
    expect((window as unknown as { __ran?: boolean }).__ran).toBeUndefined();
  });

  it("keeps web links only", () => {
    const html = '<p><a href="https://example.com/a b">site</a> <a href="javascript:alert(1)">piège</a> <a href="data:text/html,x">donnée</a></p>';
    expect(convert(html).markdown).toBe("[site](<https://example.com/a b>) piège donnée");
  });

  it("gives a table its first row as header, the same width to every row", () => {
    const html = "<table><colgroup><col><col></colgroup><tbody><tr><th><p></p></th><th></th></tr><tr><td><p><b>x</b></p></td></tr><tr><td><ul><li>y</li></ul></td><td>z</td></tr></tbody></table>";
    expect(convert(html)).toMatchObject({
      markdown: "|       |     |\n| ----- | --- |\n| **x** |     |\n| y     | z   |",
      exact: true,
    });
  });

  it("keeps what the editor cannot show as text: the text is all there", () => {
    const html = "<details><summary>Plus</summary><p>caché</p></details><dl><dt>terme</dt><dd>définition</dd></dl><p>a<sup>2</sup> <u>souligné</u> <mark>surligné</mark></p>";
    expect(convert(html)).toMatchObject({ markdown: "Plus\n\ncaché\n\nterme\n\ndéfinition\n\na2 souligné surligné", exact: true });
  });
});
