// Super notes of Standard Notes: the state of the Lexical editor, as JSON (docs/07, section 2).
// Converted into a document of the rich editor; the editor then writes the Markdown.
import type { JSONContent } from "@tiptap/core";
import { doc, hardBreak, heading, paragraph, taskItem, text, type Mark } from "./doc";
import type { ImportWarning } from "./types";

/** A Lexical node, as found in a backup: nothing is guaranteed, every field is checked. */
interface LexicalNode {
  type?: unknown;
  children?: unknown;
  text?: unknown;
  format?: unknown;
  tag?: unknown;
  listType?: unknown;
  start?: unknown;
  checked?: unknown;
  url?: unknown;
  language?: unknown;
}

// `format` of a text node is a bit mask (Lexical's TextFormatType). Underline, subscript,
// superscript and highlight have no Markdown: their text stays, without the format.
const FORMAT_MARKS: Array<[number, string]> = [
  [1, "bold"],
  [2, "italic"],
  [4, "strike"],
  [16, "code"],
];

/** Inline nodes: inside a paragraph, a heading, a list item… */
const INLINE_TYPES = new Set(["text", "linebreak", "link", "autolink", "hashtag", "tab", "code-highlight", "emoji", "keyword", "mention"]);

/** The children of `node` that are nodes: a `null` among them must not stop the import. */
const childrenOf = (node: LexicalNode): LexicalNode[] =>
  Array.isArray(node.children)
    ? (node.children as unknown[]).filter((child): child is LexicalNode => Boolean(child) && typeof child === "object")
    : [];
const typeOf = (node: LexicalNode): string => (typeof node.type === "string" ? node.type : "");

/**
 * The document of a Super note. Throws when `json` is not a Lexical state (the caller then
 * imports the text as it is). `warnings` receives what could not be kept.
 */
export function lexicalToDoc(json: string, warnings: ImportWarning[]): JSONContent {
  const state = JSON.parse(json) as { root?: LexicalNode };
  if (!state || typeof state !== "object" || !state.root || typeOf(state.root) !== "root") {
    throw new Error("not a Lexical state");
  }
  return doc(blocks(childrenOf(state.root), warnings));
}

/** The plain text of a Lexical state, to check that the conversion lost nothing. */
export function lexicalText(json: string): string {
  const collect = (node: LexicalNode): string =>
    (typeof node.text === "string" ? node.text : "") + childrenOf(node).map(collect).join(" ");
  return collect((JSON.parse(json) as { root: LexicalNode }).root);
}

function blocks(nodes: LexicalNode[], warnings: ImportWarning[]): JSONContent[] {
  return nodes.flatMap((node) => block(node, warnings));
}

function block(node: LexicalNode, warnings: ImportWarning[]): JSONContent[] {
  const type = typeOf(node);
  switch (type) {
    case "paragraph":
      return [paragraph(inline(childrenOf(node), [], warnings))];
    case "heading": {
      const level = typeof node.tag === "string" ? Number(node.tag.replace(/^h/, "")) : 1;
      return [heading(level || 1, inline(childrenOf(node), [], warnings))];
    }
    case "quote":
      return [{ type: "blockquote", content: [paragraph(inline(childrenOf(node), [], warnings))] }];
    case "list":
      return [list(node, warnings)];
    case "code":
      return [codeBlock(node)];
    case "horizontalrule":
      return [{ type: "horizontalRule" }];
    case "table":
      return [table(node, warnings)];
    default: {
      if (INLINE_TYPES.has(type)) return [paragraph(inline([node], [], warnings))];
      // Collapsible sections, layouts…: what they hold is kept, and reported once for all of
      // them (« layout »). Embedded files, images and other objects without text are dropped,
      // and reported by their name.
      const children = childrenOf(node);
      warnings.push({ code: "unsupported", detail: children.length ? "layout" : type || "?" });
      if (!children.length) return [];
      return children.every((child) => INLINE_TYPES.has(typeOf(child)))
        ? [paragraph(inline(children, [], warnings))]
        : blocks(children, warnings);
    }
  }
}

/**
 * A list. Lexical does not put a nested list inside the item above it, but in an item of its
 * own that only holds the list: that list is attached to the previous item (docs/07).
 */
function list(node: LexicalNode, warnings: ImportWarning[]): JSONContent {
  const listType = node.listType === "number" ? "orderedList" : node.listType === "check" ? "taskList" : "bulletList";
  const items: JSONContent[] = [];
  for (const item of childrenOf(node)) {
    const children = childrenOf(item);
    const nested = children.filter((child) => typeOf(child) === "list").map((child) => list(child, warnings));
    const own = children.filter((child) => typeOf(child) !== "list");
    const previous = items[items.length - 1];
    if (!own.length && nested.length && previous) {
      previous.content = [...(previous.content ?? []), ...nested];
      continue;
    }
    const content = [paragraph(inline(own, [], warnings)), ...nested];
    items.push(listType === "taskList" ? taskItem(item.checked === true, content) : { type: "listItem", content });
  }
  // A numbered list keeps its first number (checked again by the clean-up).
  return listType === "orderedList" && typeof node.start === "number"
    ? { type: listType, attrs: { start: node.start }, content: items }
    : { type: listType, content: items };
}

/** A code block: its text is in `code-highlight` and `text` nodes, its lines in `linebreak`
 * nodes. */
function codeBlock(node: LexicalNode): JSONContent {
  const code = childrenOf(node)
    .map((child) => {
      const type = typeOf(child);
      if (type === "linebreak") return "\n";
      if (type === "tab") return "\t";
      return typeof child.text === "string" ? child.text : "";
    })
    .join("");
  const language = typeof node.language === "string" ? node.language : null;
  return { type: "codeBlock", attrs: { language }, content: code ? [text(code)] : [] };
}

function table(node: LexicalNode, warnings: ImportWarning[]): JSONContent {
  return {
    type: "table",
    content: childrenOf(node).map((row) => ({
      type: "tableRow",
      content: childrenOf(row).map((cell) => ({
        type: "tableCell",
        content: blocks(childrenOf(cell), warnings),
      })),
    })),
  };
}

/** Inline content: texts with their marks, links, line breaks. `marks` are the ones of an
 * enclosing link. */
function inline(nodes: LexicalNode[], marks: Mark[], warnings: ImportWarning[]): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    const type = typeOf(node);
    if (type === "linebreak") return [hardBreak()];
    if (type === "tab") return [text("\t", marks)];
    if (type === "link" || type === "autolink") {
      const href = typeof node.url === "string" ? node.url : "";
      return inline(childrenOf(node), [...marks, { type: "link", attrs: { href } }], warnings);
    }
    if (typeof node.text === "string") {
      const format = typeof node.format === "number" ? node.format : 0;
      const formatMarks = FORMAT_MARKS.filter(([bit]) => format & bit).map(([, name]) => ({ type: name }));
      return node.text ? [text(node.text, [...formatMarks, ...marks])] : [];
    }
    const children = childrenOf(node);
    if (!children.length && type) warnings.push({ code: "unsupported", detail: type });
    // A block inside a paragraph (cannot be written in Markdown): its text joins the line.
    return inline(children, marks, warnings);
  });
}
