// TipTap documents (JSON) built by the import, and the clean-up every imported rich note goes
// through before the editor writes its Markdown (docs/07, "Méthode de conversion").
//
// Each converter (Lexical, HTML, checklists, plain text) produces a document in the editor's
// schema; the editor itself then writes the Markdown, with the rules of docs/05. The clean-up
// removes what Markdown cannot keep, so that the Markdown reads back as exactly this document.
import type { JSONContent } from "@tiptap/core";
import { normalizeLanguage } from "../editor/languages";

export type Mark = NonNullable<JSONContent["marks"]>[number];

export const text = (value: string, marks: Mark[] = []): JSONContent =>
  marks.length ? { type: "text", text: value, marks } : { type: "text", text: value };
export const hardBreak = (): JSONContent => ({ type: "hardBreak" });
export const paragraph = (content: JSONContent[] = []): JSONContent => ({ type: "paragraph", content });
export const heading = (level: number, content: JSONContent[]): JSONContent => ({
  type: "heading",
  attrs: { level },
  content,
});
export const doc = (content: JSONContent[]): JSONContent => ({ type: "doc", content });
export const taskItem = (checked: boolean, content: JSONContent[]): JSONContent => ({
  type: "taskItem",
  attrs: { checked },
  content,
});

/** Text lines → inline content: one hard break between two lines. */
export function linesToInline(lines: string[]): JSONContent[] {
  return lines.flatMap((line, index) => (index === 0 ? [text(line)] : [hardBreak(), text(line)]));
}

/** Link targets kept: the web and e-mail. Anything else (`javascript:`, `file:`, a custom
 * scheme) would open something else than a web page on Ctrl+click: the text stays, as text. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null;
}

const KEPT_MARKS = new Set(["bold", "italic", "strike", "code", "link"]);

export interface CleanOptions {
  /** Collapses runs of spaces, as HTML shows them. Off for typed text (plain text, Lexical,
   * checklists), where several spaces in a row were visible and are kept. */
  collapseSpaces: boolean;
}

/** The clean-up of a converted document (see the top of this file). */
export function cleanDoc(document: JSONContent, options: CleanOptions): JSONContent {
  const content = cleanBlocks(document.content ?? [], options);
  return doc(content.length ? content : [paragraph()]);
}

function cleanBlocks(nodes: JSONContent[], options: CleanOptions): JSONContent[] {
  return nodes.flatMap((node) => cleanBlock(node, options));
}

/** One block, cleaned: none (empty, or nothing to keep), one, or several (a paragraph split at
 * an empty line). */
function cleanBlock(node: JSONContent, options: CleanOptions): JSONContent[] {
  switch (node.type) {
    case "paragraph":
      return splitAtEmptyLines(cleanInline(node.content ?? [], options)).map((content) =>
        paragraph(content),
      );
    case "heading": {
      // Headings 1 to 3 only (docs/05); a line break in a heading cannot be written in Markdown.
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 3);
      const inline = (node.content ?? []).map((child) => (child.type === "hardBreak" ? text(" ") : child));
      const content = cleanInline(inline, options);
      return content.length ? [heading(level, content)] : [];
    }
    case "blockquote": {
      const content = cleanBlocks(node.content ?? [], options);
      return content.length ? [{ type: "blockquote", content }] : [];
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return cleanList(node, options);
    case "codeBlock":
      return cleanCodeBlock(node);
    case "horizontalRule":
      return [{ type: "horizontalRule" }];
    case "table":
      return cleanTable(node, options);
    default:
      // Not a block of the editor (cannot happen with the converters): its text is kept.
      return cleanBlocks(node.content ?? [], options);
  }
}

function cleanList(node: JSONContent, options: CleanOptions): JSONContent[] {
  const task = node.type === "taskList";
  const items = (node.content ?? []).flatMap((item) => {
    // The schema wants the matching kind of item: a task list holds task items.
    const blocks = cleanBlocks(item.content ?? [], options);
    if (!blocks.some(hasText)) return []; // An empty item (often a slip of the keyboard).
    // An item starts with its text; one that only holds a sub-list gets an empty text.
    const content = blocks[0]?.type === "paragraph" ? blocks : [paragraph(), ...blocks];
    return task
      ? [taskItem(item.attrs?.checked === true, content)]
      : [{ type: "listItem", content }];
  });
  return items.length ? [{ type: node.type, content: items }] : [];
}

function cleanCodeBlock(node: JSONContent): JSONContent[] {
  const code = (node.content ?? [])
    .map((child) => (child.type === "hardBreak" ? "\n" : (child.text ?? "")))
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    // Blank lines around the code carry no meaning, and a final one would not read back.
    .replace(/^\n+|\s+$/g, "");
  if (!code) return [];
  const language = normalizeLanguage(node.attrs?.language as string | undefined);
  return [
    {
      type: "codeBlock",
      attrs: { language: language === "plaintext" ? null : language },
      content: [text(code)],
    },
  ];
}

/** GFM tables: a header row first, the same number of cells on every row, and cells holding
 * text only (docs/05). Anything else in a cell is kept as its text. */
function cleanTable(node: JSONContent, options: CleanOptions): JSONContent[] {
  const rows = (node.content ?? [])
    .map((row) =>
      (row.content ?? []).map((cell) => {
        const paragraphs = flattenToParagraphs(cell.content ?? [], options);
        return paragraphs.length ? paragraphs : [paragraph()];
      }),
    )
    .filter((cells) => cells.length > 0);
  if (!rows.some((cells) => cells.some((paragraphs) => paragraphs.some(hasText)))) return [];
  const width = Math.max(...rows.map((cells) => cells.length));
  return [
    {
      type: "table",
      content: rows.map((cells, rowIndex) => ({
        type: "tableRow",
        content: Array.from({ length: width }, (_, index) => ({
          type: rowIndex === 0 ? "tableHeader" : "tableCell",
          content: cells[index] ?? [paragraph()],
        })),
      })),
    },
  ];
}

/** The text of any blocks, as paragraphs (lists, headings, code… in a table cell). */
function flattenToParagraphs(nodes: JSONContent[], options: CleanOptions): JSONContent[] {
  return nodes.flatMap((node) => {
    if (node.type === "paragraph" || node.type === "heading") {
      return cleanBlock({ type: "paragraph", content: node.content }, options);
    }
    if (node.type === "codeBlock") {
      const code = (node.content ?? []).map((child) => child.text ?? "").join("");
      return code.split("\n").flatMap((line) =>
        line.trim() ? [paragraph([text(line.trim(), [{ type: "code" }])])] : [],
      );
    }
    if (node.type === "text" || node.type === "hardBreak") {
      return cleanBlock(paragraph([node]), options);
    }
    return flattenToParagraphs(node.content ?? [], options);
  });
}

function hasText(node: JSONContent): boolean {
  if (node.type === "text") return Boolean(node.text?.trim());
  if (node.type === "horizontalRule") return true;
  return (node.content ?? []).some(hasText);
}

// ── Inline content ─────────────────────────────────────────────────────────────────────────

/** Marks Markdown can write, with a safe link target. Inline code stands alone in Markdown
 * (the editor's code mark excludes the others): with a link, the link wins. */
function cleanMarks(marks: Mark[] | undefined): Mark[] {
  const kept: Mark[] = [];
  for (const mark of marks ?? []) {
    if (!KEPT_MARKS.has(mark.type) || kept.some((other) => other.type === mark.type)) continue;
    if (mark.type === "link") {
      const href = safeHref(mark.attrs?.href);
      if (href) kept.push({ type: "link", attrs: { href } });
    } else {
      kept.push({ type: mark.type });
    }
  }
  if (!kept.some((mark) => mark.type === "code")) return kept;
  const link = kept.find((mark) => mark.type === "link");
  return link ? kept.filter((mark) => mark.type !== "code") : [{ type: "code" }];
}

const sameMarks = (a: Mark[], b: Mark[]) =>
  a.length === b.length && a.every((mark, index) => JSON.stringify(mark) === JSON.stringify(b[index]));

/**
 * Inline content as Markdown can write it back exactly: no-break spaces become spaces, spaces
 * move out of bold, italic… (`** b**` is not bold in Markdown), no spaces or line breaks at the
 * start and end of the block, nor around a line break.
 */
function cleanInline(nodes: JSONContent[], options: CleanOptions): JSONContent[] {
  // 1. Text and line breaks only, with the kept marks; spaces moved out of the marks.
  const pieces: JSONContent[] = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      pieces.push(hardBreak());
      continue;
    }
    if (node.type !== "text") {
      // A node of another kind (cannot happen with the converters): its text is kept.
      pieces.push(...cleanInline(node.content ?? [], options));
      continue;
    }
    let value = (node.text ?? "").replace(/ /g, " ").replace(/\r\n?|\n/g, " ");
    if (options.collapseSpaces) value = value.replace(/[ \t]+/g, " ");
    const marks = cleanMarks(node.marks);
    if (!marks.length) {
      pieces.push(text(value));
      continue;
    }
    const [, before, middle, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(value) ?? ["", "", value, ""];
    if (before) pieces.push(text(before));
    if (middle) pieces.push(text(middle, marks));
    if (after) pieces.push(text(after));
  }
  // 2. Neighbours with the same marks become one text; spaces around them are collapsed.
  const merged: JSONContent[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (piece.type === "text" && last?.type === "text" && sameMarks(last.marks ?? [], piece.marks ?? [])) {
      merged[merged.length - 1] = text(last.text + (piece.text ?? ""), piece.marks ?? []);
    } else {
      merged.push(piece);
    }
  }
  if (options.collapseSpaces) {
    for (let index = 1; index < merged.length; index++) {
      const previous = merged[index - 1];
      const current = merged[index];
      if (previous.type === "text" && current.type === "text" && previous.text?.endsWith(" ")) {
        merged[index] = text((current.text ?? "").replace(/^ +/, ""), current.marks ?? []);
      }
    }
  }
  // 3. No spaces at the end of a line: before a line break they would read back as another
  // one, and at the end of the block they are dropped. When spaces are collapsed, none at the
  // start of a line either; otherwise they are an indentation, kept (docs/05 writes them back).
  for (let index = 0; index < merged.length; index++) {
    const node = merged[index];
    if (node.type !== "text") continue;
    let value = node.text ?? "";
    const next = merged[index + 1];
    const previous = merged[index - 1];
    if (!next || next.type === "hardBreak") value = value.replace(/[ \t]+$/, "");
    if (options.collapseSpaces && (!previous || previous.type === "hardBreak")) {
      value = value.replace(/^[ \t]+/, "");
    }
    merged[index] = text(value, node.marks ?? []);
  }
  const content = merged.filter((node) => node.type !== "text" || node.text);
  // 4. No line break at the start or the end.
  while (content[0]?.type === "hardBreak") content.shift();
  while (content[content.length - 1]?.type === "hardBreak") content.pop();
  return content;
}

/** Splits inline content at empty lines (two line breaks in a row, or a line of spaces): an
 * empty line ends a paragraph in Markdown. */
function splitAtEmptyLines(content: JSONContent[]): JSONContent[][] {
  const parts: JSONContent[][] = [[]];
  for (let index = 0; index < content.length; index++) {
    const node = content[index];
    if (node.type === "hardBreak" && content[index + 1]?.type === "hardBreak") {
      while (content[index + 1]?.type === "hardBreak") index++;
      parts.push([]);
      continue;
    }
    parts[parts.length - 1].push(node);
  }
  return parts
    .map((part) => {
      while (part[0]?.type === "hardBreak") part.shift();
      while (part[part.length - 1]?.type === "hardBreak") part.pop();
      return part;
    })
    .filter((part) => part.some((node) => node.type === "text" && node.text?.trim()));
}

