// TipTap documents (JSON) built by the import, and the clean-up every imported rich note goes
// through before the editor writes its Markdown (docs/07, "Méthode de conversion").
//
// Each converter (Lexical, HTML, checklists, plain text) produces a document in the editor's
// schema; the editor itself then writes the Markdown, with the rules of docs/05. The clean-up
// removes what Markdown cannot keep, so that the Markdown reads back as exactly this document.
import type { JSONContent } from "@tiptap/core";
import { normalizeLanguage } from "../editor/languages";
import type { ImportWarning } from "./types";

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
  /** Receives what the clean-up could not keep as it was (a table too big…). */
  warnings?: ImportWarning[];
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
  if (!items.length) return [];
  // A numbered list may go on after a code block or a paragraph: its first number is kept.
  // GFM numbers have 1 to 9 digits.
  const start = Number(node.attrs?.start);
  if (node.type === "orderedList" && Number.isInteger(start) && start > 1 && start <= 999_999_999) {
    return [{ type: node.type, attrs: { start }, content: items }];
  }
  return [{ type: node.type, content: items }];
}

function cleanCodeBlock(node: JSONContent): JSONContent[] {
  let code = (node.content ?? [])
    .map((child) => (child.type === "hardBreak" ? "\n" : (child.text ?? "")))
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    // Blank lines around the code carry no meaning, and a final one would not read back.
    // (`trimEnd` and a loop rather than a regular expression: see `trimEndSpaces`.)
    .trimEnd();
  let first = 0;
  while (code[first] === "\n") first++;
  code = code.slice(first);
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

/**
 * Beyond these, a table is kept as lines of text. Every row is padded to the widest one: a
 * crafted table (one row of 1,000 cells, then 1,000 rows of one) would become a million cells,
 * and freeze the import (security review, phase 4).
 */
const MAX_TABLE_COLUMNS = 64;
const MAX_TABLE_CELLS = 20_000;

/** GFM tables: a header row first, the same number of cells on every row, and cells holding
 * text only (docs/05). Anything else in a cell is kept as its text. A cell is one paragraph:
 * the editor writes the line breaks of a cell as `<br>`, and reads them back as line breaks. */
function cleanTable(node: JSONContent, options: CleanOptions): JSONContent[] {
  // The inline content of each cell, row by row.
  const rows = (node.content ?? [])
    .map((row) =>
      (row.content ?? []).map((cell) =>
        flattenToParagraphs(cell.content ?? [], options).flatMap((line, index) =>
          index === 0 ? line : [hardBreak(), ...line],
        ),
      ),
    )
    .filter((cells) => cells.length > 0);
  if (!rows.some((cells) => cells.some((cell) => cell.some(hasText)))) return [];
  // A loop rather than `Math.max(...)`, which fails on a very long list of rows.
  const width = rows.reduce((widest, cells) => Math.max(widest, cells.length), 0);
  if (width > MAX_TABLE_COLUMNS || width * rows.length > MAX_TABLE_CELLS) {
    options.warnings?.push({ code: "unsupported", detail: "big_table" });
    // One paragraph per row, its cells separated by « | »: the text is all there.
    return rows.map((cells) =>
      paragraph(cells.flatMap((cell, index) => (index === 0 ? cell : [text(" | "), ...cell]))),
    );
  }
  return [
    {
      type: "table",
      content: rows.map((cells, rowIndex) => ({
        type: "tableRow",
        content: Array.from({ length: width }, (_, index) => ({
          type: rowIndex === 0 ? "tableHeader" : "tableCell",
          content: [paragraph(cells[index] ?? [])],
        })),
      })),
    },
  ];
}

/** The text of any blocks (lists, headings, code… in a table cell), as the inline content of
 * its lines. */
function flattenToParagraphs(nodes: JSONContent[], options: CleanOptions): JSONContent[][] {
  return nodes.flatMap((node) => {
    if (node.type === "paragraph" || node.type === "heading") {
      // Not split at empty lines: a cell keeps them (`a<br><br>b`).
      const content = cleanInline(node.content ?? [], options);
      return content.length ? [content] : [];
    }
    if (node.type === "codeBlock") {
      const code = (node.content ?? []).map((child) => child.text ?? "").join("");
      return code.split("\n").flatMap((line) => (line.trim() ? [[text(line.trim(), [{ type: "code" }])]] : []));
    }
    if (node.type === "text" || node.type === "hardBreak") {
      const content = cleanInline([node], options);
      return content.length ? [content] : [];
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
    const middle = value.trim();
    const before = value.slice(0, value.length - value.trimStart().length);
    const after = value.slice(value.trimEnd().length);
    if (before) pieces.push(text(before));
    if (middle) pieces.push(text(middle, marks));
    if (after) pieces.push(text(after));
  }
  // 2. Neighbours with the same marks become one text; spaces around them are collapsed.
  const merged = mergeNeighbours(pieces);
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
    if (!next || next.type === "hardBreak") value = trimEndSpaces(value);
    if (options.collapseSpaces && (!previous || previous.type === "hardBreak")) {
      value = value.replace(/^[ \t]+/, "");
    }
    merged[index] = text(value, node.marks ?? []);
  }
  const content = merged.filter((node) => node.type !== "text" || node.text);
  // 4. No line break at the start or the end.
  while (content[0]?.type === "hardBreak") content.shift();
  while (content[content.length - 1]?.type === "hardBreak") content.pop();
  return mergeNeighbours(readableDelimiters(content));
}

/** Neighbouring texts with the same marks, as one text. */
function mergeNeighbours(pieces: JSONContent[]): JSONContent[] {
  const merged: JSONContent[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (piece.type === "text" && last?.type === "text" && sameMarks(last.marks ?? [], piece.marks ?? [])) {
      merged[merged.length - 1] = text(last.text + (piece.text ?? ""), piece.marks ?? []);
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

/** Marks written with `*`, `_` or `~` around their text. */
const DELIMITED = new Set(["bold", "italic", "strike"]);
const PUNCTUATION = /[\p{P}\p{S}]/u;
/** A letter or a digit: neither a space nor a punctuation mark. */
const isWordChar = (char: string | undefined) => Boolean(char) && !/\s/u.test(char!) && !PUNCTUATION.test(char!);

/**
 * Markdown only reads `**…**` as bold when the text inside does not end with a punctuation mark
 * glued to a letter outside: `**Note:**suite` stays as typed, stars included. The same goes for
 * the start (`mot**(gras)**`) and for italic and strikethrough. Such punctuation marks move out
 * of the mark: `**Note**:suite` is bold again, which matters more than the bold colon.
 */
function readableDelimiters(content: JSONContent[]): JSONContent[] {
  const result: JSONContent[] = [];
  content.forEach((node, index) => {
    if (node.type !== "text" || !node.text) {
      result.push(node);
      return;
    }
    const marks = node.marks ?? [];
    const has = (other: JSONContent | undefined, type: string) => other?.marks?.some((mark) => mark.type === type) ?? false;
    const previous = content[index - 1];
    const next = content[index + 1];
    // The marks that open on this text, and those that close on it.
    const opening = marks.filter((mark) => DELIMITED.has(mark.type) && !has(previous, mark.type)).map((mark) => mark.type);
    const closing = marks.filter((mark) => DELIMITED.has(mark.type) && !has(next, mark.type)).map((mark) => mark.type);
    const chars = Array.from(node.text);
    let first = 0;
    let last = chars.length;
    if (opening.length && isWordChar(Array.from(previous?.type === "text" ? (previous.text ?? "") : "").pop())) {
      while (first < last && PUNCTUATION.test(chars[first])) first++;
    }
    if (closing.length && isWordChar(next?.type === "text" ? Array.from(next.text ?? "")[0] : undefined)) {
      while (last > first && PUNCTUATION.test(chars[last - 1])) last--;
    }
    const without = (types: string[]) => marks.filter((mark) => !types.includes(mark.type));
    if (first > 0) result.push(text(chars.slice(0, first).join(""), without(opening)));
    if (last > first) result.push(text(chars.slice(first, last).join(""), marks));
    if (last < chars.length) result.push(text(chars.slice(Math.max(first, last)).join(""), without(closing)));
  });
  return result;
}

/**
 * `value` without the spaces and tabs at its end. A loop, not `/[ \t]+$/`: a backup is not
 * trusted, and that expression takes a time quadratic in a long run of spaces inside the text
 * (security review, phase 4).
 */
export function trimEndSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === " " || value[end - 1] === "\t")) end--;
  return value.slice(0, end);
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

