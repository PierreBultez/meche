// Rich-text notes of Standard Notes (the « Plus » editor): HTML, often pasted from web pages
// (docs/07, section 2). Read by the rich editor's own HTML rules, after a clean-up.
import type { JSONContent } from "@tiptap/core";
import { DOMParser as SchemaParser, type Schema } from "@tiptap/pm/model";
import type { ImportWarning } from "./types";

/** Elements dropped with everything inside: scripts, styles, forms, the « Copier » buttons of
 * pasted code blocks… They hold no text of the note. */
const DROPPED = "script, style, template, noscript, head, meta, link, button, select, textarea, svg";
/** Embedded objects: dropped, and reported (the note may have shown something there). */
const EMBEDDED = "img, picture, video, audio, iframe, object, embed, canvas, math";

/**
 * The document of an HTML note, and its text before conversion (to check that nothing was
 * lost). `warnings` receives what could not be kept.
 *
 * The HTML is read by `DOMParser`: a document that is never displayed. Its scripts do not run
 * and its images are not loaded (and the app's CSP allows no outside address anyway).
 */
export function htmlToDoc(html: string, schema: Schema, warnings: ImportWarning[]): { doc: JSONContent; sourceText: string } {
  const body = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html").body;
  body.querySelectorAll(DROPPED).forEach((element) => element.remove());
  body.querySelectorAll(EMBEDDED).forEach((element) => {
    warnings.push({ code: "unsupported", detail: element.tagName.toLowerCase() });
    element.remove();
  });
  markTaskLists(body);
  body.querySelectorAll("h4, h5, h6").forEach((element) => rename(element, "h3"));
  body.querySelectorAll("b, strong").forEach((element) => {
    // Pasted from some editors, `<b style="font-weight: 400">` wraps text that is not bold.
    const weight = (element as HTMLElement).style.fontWeight;
    if (weight === "normal" || weight === "lighter" || (Number(weight) > 0 && Number(weight) < 600)) {
      rename(element, "span");
    }
  });
  body.querySelectorAll("pre").forEach(prepareCodeBlock);
  body.querySelectorAll("td, th").forEach(flattenCell);
  keepLinksOfCode(body);
  body.querySelectorAll("li").forEach(startItemWithText);
  const sourceText = body.textContent ?? "";
  const doc = SchemaParser.fromSchema(schema).parse(body).toJSON() as JSONContent;
  return { doc, sourceText };
}

/** Blocks a table cell cannot hold (docs/05: text only): a list item, a heading… becomes a
 * paragraph of the cell; a list around them is removed. Without this, the editor's reader would
 * take them out of the table, and cut it in two. A code block keeps its lines, as inline code. */
function flattenCell(cell: Element): void {
  const page = cell.ownerDocument;
  cell.querySelectorAll("pre").forEach((pre) => {
    const lines = (pre.textContent ?? "").split("\n").filter((line) => line.trim());
    const replacement = page.createElement("p");
    lines.forEach((line, index) => {
      if (index > 0) replacement.append(page.createElement("br"));
      const code = page.createElement("code");
      code.textContent = line.trim();
      replacement.append(code);
    });
    pre.replaceWith(replacement);
  });
  cell.querySelectorAll("ul, ol").forEach((list) => list.replaceWith(...Array.from(list.childNodes)));
  cell.querySelectorAll("li, h1, h2, h3, h4, h5, h6, blockquote, div, dl, dt, dd").forEach((block) => rename(block, "p"));
}

/**
 * Inline code cannot hold a link in the editor, nor be in one: its reader would drop the link.
 * With a link, the link wins (docs/07): the code around or inside it becomes plain text.
 */
function keepLinksOfCode(body: HTMLElement): void {
  const codes = new Set<Element>(body.querySelectorAll("a[href] code"));
  body.querySelectorAll("code a[href]").forEach((link) => {
    const code = link.closest("code");
    if (code) codes.add(code);
  });
  for (const code of codes) {
    if (!code.closest("pre")) code.replaceWith(...Array.from(code.childNodes));
  }
}

/** Blocks that cannot be the first thing in a list item of the editor: the item must start with
 * its text. */
const BLOCKS = new Set(["UL", "OL", "PRE", "BLOCKQUOTE", "TABLE", "HR", "DL"]);

/**
 * A list item starting with a heading or a block: its heading becomes its text, and an item
 * that starts with a block (a sub-list…) gets an empty text first, as in Lexical notes. Without
 * this, the editor's reader took the heading out of the list, and the sub-list up a level.
 */
function startItemWithText(item: Element): void {
  if (item.getAttribute("data-type") === "taskItem") return;
  const first = Array.from(item.childNodes).find(
    (node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim(),
  );
  if (!first || first.nodeType !== Node.ELEMENT_NODE) return;
  const element = first as Element;
  if (/^H[1-6]$/.test(element.tagName)) rename(element, "p");
  else if (BLOCKS.has(element.tagName)) element.before(item.ownerDocument.createElement("p"));
}

/** Replaces `element` by an element named `tag`, with the same children and attributes. */
function rename(element: Element, tag: string): void {
  const replacement = element.ownerDocument.createElement(tag);
  for (const attribute of Array.from(element.attributes)) {
    replacement.setAttribute(attribute.name, attribute.value);
  }
  replacement.append(...Array.from(element.childNodes));
  element.replaceWith(replacement);
}

/**
 * Checklists. The editor reads its own form (`ul[data-type=taskList] > li[data-type=taskItem]`).
 * Pasted Markdown gives `<li><input type="checkbox"> …</li>` instead: such items are given the
 * editor's form. A list mixing both keeps its bullets, and its boxes become « [ ] » text.
 */
function markTaskLists(body: HTMLElement): void {
  const lists = new Set<Element>();
  body.querySelectorAll('li input[type="checkbox"]').forEach((input) => {
    const item = input.closest("li");
    // The editor's own form already says whether the box is checked (`data-checked`).
    if (!item || item.getAttribute("data-type") === "taskItem") return;
    if (leadingCheckbox(item) === input && item.parentElement) lists.add(item.parentElement);
  });
  for (const list of lists) {
    const items = Array.from(list.children).filter((child) => child.tagName === "LI");
    const boxes = items.map(leadingCheckbox);
    const allTasks = boxes.every(Boolean);
    items.forEach((item, index) => {
      const box = boxes[index];
      if (!box) return;
      const checked = box.checked || box.hasAttribute("checked");
      const label = box.parentElement?.tagName === "LABEL" ? box.parentElement : null;
      if (allTasks) {
        item.setAttribute("data-type", "taskItem");
        item.setAttribute("data-checked", String(checked));
      } else {
        box.before(item.ownerDocument.createTextNode(checked ? "[x] " : "[ ] "));
      }
      box.remove();
      if (label && !label.textContent?.trim()) label.remove();
    });
    if (allTasks) list.setAttribute("data-type", "taskList");
  }
}

/** The checkbox at the very start of `item` (before any text), if any. */
function leadingCheckbox(item: Element): HTMLInputElement | null {
  const walker = item.ownerDocument.createTreeWalker(item, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) return null;
      continue;
    }
    const element = node as Element;
    if (element.tagName === "INPUT") {
      return (element as HTMLInputElement).type === "checkbox" ? (element as HTMLInputElement) : null;
    }
    if (element.tagName === "LI" && element !== item) return null;
  }
  return null;
}

/**
 * A code block becomes `<pre><code class="language-…">code</code></pre>`, the form the editor
 * reads. The code is taken from the text, with `<br>` and line elements (one `<div>` per line,
 * as some sites write them) as line breaks: highlighting spans would otherwise be read as is.
 */
function prepareCodeBlock(pre: Element): void {
  const language = languageOf(pre) ?? languageOf(pre.querySelector("code"));
  const code = codeText(pre).replace(/\n$/, "");
  const element = pre.ownerDocument.createElement("code");
  if (language) element.className = `language-${language}`;
  element.textContent = code;
  pre.replaceChildren(element);
}

function languageOf(element: Element | null): string | null {
  if (!element) return null;
  const fromClass = Array.from(element.classList)
    .map((name) => /^(?:language|lang)-(.+)$/.exec(name)?.[1])
    .find(Boolean);
  return fromClass ?? element.getAttribute("data-language");
}

const LINE_ELEMENTS = new Set(["DIV", "P", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6"]);

function codeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  if (element.tagName === "BR") return "\n";
  let code = Array.from(element.childNodes).map(codeText).join("");
  if (LINE_ELEMENTS.has(element.tagName) && !code.endsWith("\n")) code += "\n";
  return code;
}
