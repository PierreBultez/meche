// TipTap extensions of rich notes (docs/05). Only MIT packages published on npm.
// The same list is used by the editor and by the Markdown tests, so both share one schema.
import type { AnyExtension, JSONContent } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Link from "@tiptap/extension-link";
import { ListItem, OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import {
  Table,
  TableCell,
  TableHeader,
  TableKit,
  renderTableToMarkdown,
} from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Marked, type marked } from "marked";
import { codeFence } from "../utils/code-fence";
import { lowlight } from "./lowlight";
import { escapeBlockStarts } from "./markdown-escape";

export interface RichExtensionOptions {
  /** Extra extensions of the interactive editor (slash menu, code block view…). */
  extra?: AnyExtension[];
  /** Replaces the default code block (for instance to give it a Vue node view). */
  codeBlock?: AnyExtension;
}

// Without a language, a block stays plain text (lowlight would otherwise guess one).
// The stock Markdown renderer always writes a ``` fence, so a code block containing a ``` line
// (Markdown pasted in a block, a code note converted to rich) would be cut when read back:
// the fence is made longer than any run of backticks in the code.
export const baseCodeBlock = CodeBlockLowlight.extend({
  renderMarkdown(node, helpers) {
    const language = (node.attrs?.language as string | null | undefined) ?? "";
    const code = node.content ? helpers.renderChildren(node.content) : "";
    const fence = codeFence(code);
    return `${fence}${language}\n${code}\n${fence}`;
  },
}).configure({ lowlight, defaultLanguage: "plaintext" });

// The Markdown reader tries every tokenizer below at the start of each block, on all the text
// left to read. TipTap's own ones split that whole text into lines each time: reading a note
// took a time growing with the square of its length (3.6 s for 4,000 short checklists). They
// are given only the lines they can use, after a cheap look at the first ones.

/** The line of `src` starting at `start`, without the line break. */
function lineAt(src: string, start: number): string {
  const end = src.indexOf("\n", start);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

/** A table starts here: a first line with "|", then a delimiter row ("| --- | --- |"). */
function startsTable(src: string): boolean {
  const firstEnd = src.indexOf("\n");
  if (firstEnd === -1) return false;
  const delimiter = lineAt(src, firstEnd + 1);
  return /^[ \t|:]*-[ \t|:-]*$/.test(delimiter) && delimiter.includes("|") && src.slice(0, firstEnd).includes("|");
}

const stockTableTokenizer = Table.config.markdownTokenizer;

/** Table without the blank lines the default renderer adds around it (one even at the very
 * start of a note that begins with a table). */
const TidyTable = Table.extend({
  renderMarkdown(node, helpers) {
    return renderTableToMarkdown(node, helpers).replace(/^\n+|\n+$/g, "");
  },
  markdownTokenizer: stockTableTokenizer && {
    ...stockTableTokenizer,
    // Same tests as the stock ones, on the first two lines only.
    start: (src) => (startsTable(src) ? 0 : -1),
    tokenize: (src, tokens, lexer) => {
      if (!startsTable(src)) return undefined;
      // A table ends at the first blank line: the stock tokenizer looks no further.
      const blank = src.indexOf("\n\n");
      return stockTableTokenizer.tokenize(blank === -1 ? src : src.slice(0, blank), tokens, lexer);
    },
  },
});

/** GFM stores a table cell on one line: no list, heading or code block in a cell. A cell keeps
 * several paragraphs (written with <br>), so Entrée still works in it. */
const InlineTableCell = TableCell.extend({ content: "paragraph+" });
const InlineTableHeader = TableHeader.extend({ content: "paragraph+" });

/** Text and line breaks: what a paragraph holds. */
const isInline = (node: JSONContent | undefined) => node?.type === "text" || node?.type === "hardBreak";

/**
 * A list item as the schema wants it, or it is dropped on the next save:
 * - it starts with a paragraph: an item whose text was erased but which still has sub-items is
 *   read back with its empty paragraph;
 * - its text is in paragraphs: a line under a sub-list, not indented enough, is read as bare
 *   text right in the item.
 */
function tidyListItem(item: JSONContent): void {
  if (item.type !== "listItem") return;
  const content: JSONContent[] = [];
  let bare: JSONContent | null = null;
  for (const child of item.content ?? []) {
    if (!isInline(child)) {
      content.push(child);
      bare = null;
    } else if (bare) {
      bare.content?.push(child);
    } else {
      bare = { type: "paragraph", content: [child] };
      content.push(bare);
    }
  }
  item.content = content[0]?.type === "paragraph" ? content : [{ type: "paragraph" }, ...content];
}

/** A list item whose text is empty but which has sub-items. */
function isEmptiedParent(item: JSONContent | undefined): boolean {
  return (
    item?.type === "listItem" &&
    (item.content?.length ?? 0) > 1 &&
    item.content?.[0]?.type === "paragraph" &&
    !item.content[0].content?.length
  );
}

const SafeListItem = ListItem.extend({
  renderMarkdown(node, helpers, context) {
    let markdown = this.parent?.(node, helpers, context) ?? "";
    // An emptied bullet with sub-items is written "-" alone on its line: the parser reads "- "
    // followed by a line break as a paragraph, and the sub-items would move up a level.
    if (context?.parentType === "bulletList" && markdown.startsWith("- \n")) {
      markdown = `-${markdown.slice(2)}`;
    }
    // Right under this item's text, that "-" would underline it as a heading: a blank line
    // separates them. The same goes for a horizontal rule ("---") right under it.
    const [text, next] = node.content ?? [];
    if (text?.type === "paragraph" && text.content?.length) {
      if (next?.type === "bulletList" && isEmptiedParent(next.content?.[0])) {
        markdown = markdown.replace(/\n([ \t]*-)(?=\n)/, "\n\n$1");
      } else if (next?.type === "horizontalRule") {
        // The item's own text cannot hold such a line: SafeParagraph escapes it ("\---").
        markdown = markdown.replace(/\n([ \t]*---)(?=\n|$)/, "\n\n$1");
      }
    }
    return markdown;
  },
  parseMarkdown(token, helpers) {
    const parsed = this.parent?.(token, helpers);
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (item) tidyListItem(item as JSONContent);
    }
    return parsed as ReturnType<NonNullable<typeof this.parent>>;
  },
});

/** Spaces at the end of `text`. A loop: `/ {2,}$/` would take a quadratic time on a long run
 * of spaces inside the text. */
function trailingSpaces(text: string): number {
  let count = 0;
  while (text[text.length - 1 - count] === " ") count++;
  return count;
}

/**
 * Task item whose text holds line breaks (Maj+Entrée). TipTap reads only the first line of a task
 * item as its text: the next lines became another paragraph, or, not indented, ended the
 * checklist. They are written indented under the box, and read back into the same text.
 */
const SafeTaskItem = TaskItem.extend({
  renderMarkdown(node, helpers, context) {
    const markdown = this.parent?.(node, helpers, context) ?? "";
    const text = node.content?.[0];
    // One line of Markdown per line break of the item's own text, right after its first line.
    const breaks = text?.type === "paragraph" ? (text.content ?? []).filter((child) => child.type === "hardBreak").length : 0;
    if (!breaks) return markdown;
    return markdown
      .split("\n")
      .map((line, index) => (index >= 1 && index <= breaks ? `  ${line}` : line))
      .join("\n");
  },
  parseMarkdown(token, helpers) {
    const parsed = this.parent?.(token, helpers) as JSONContent;
    const [first, ...others] = parsed.content ?? [];
    if (first?.type !== "paragraph" || !others.length) return parsed;
    const last = first.content?.[first.content.length - 1];
    // Two spaces at the end of the first line: the mark of a line break.
    const spaces = last?.type === "text" ? trailingSpaces(last.text ?? "") : 0;
    // The next lines of the text come as a paragraph of their own, or, in a checklist nested in
    // another list, as bare text right in the item, which the schema refuses (the note would be
    // dropped on the next save): they are put back into the first paragraph in both cases.
    let next: JSONContent[];
    let rest: JSONContent[];
    if (isInline(others[0])) {
      const end = others.findIndex((node) => !isInline(node));
      next = end === -1 ? others : others.slice(0, end);
      rest = end === -1 ? [] : others.slice(end);
    } else if (others[0].type === "paragraph" && spaces >= 2) {
      next = others[0].content ?? [];
      rest = others.slice(1);
    } else {
      return parsed;
    }
    const firstLine = spaces
      ? [...(first.content ?? []).slice(0, -1), { ...last, text: (last?.text ?? "").slice(0, -spaces) }]
      : (first.content ?? []);
    // Without the two spaces, the lines were joined by a plain line break of Markdown: a space.
    const separator: JSONContent = spaces >= 2 ? { type: "hardBreak" } : { type: "text", text: " " };
    const joined = [...firstLine, separator, ...next].filter((child) => child.type !== "text" || child.text);
    return { ...parsed, content: [{ ...first, content: joined }, ...rest] };
  },
});

// The line pattern of TipTap's task list reader.
const TASK_ITEM_LINE = /^\s*[-+*]\s+\[[ xX]\]\s+/;
const stockTaskListTokenizer = TaskList.config.markdownTokenizer;

/**
 * The lines a task list starting at the beginning of `src` can take, or null when it does not
 * start with one (after blank lines, which the stock reader skips). The list never goes past a
 * line that is neither blank, nor indented, nor a task: the text is cut right before it.
 */
function taskListLines(src: string): string | null {
  let start = 0;
  let started = false;
  while (start < src.length) {
    const line = lineAt(src, start);
    if (line.trim()) {
      if (!started) {
        if (!TASK_ITEM_LINE.test(line)) return null;
        started = true;
      } else if (/^\S/.test(line) && !TASK_ITEM_LINE.test(line)) {
        return src.slice(0, start);
      }
    }
    start += line.length + 1;
  }
  return started ? src : null;
}

const SafeTaskList = TaskList.extend({
  markdownTokenizer: stockTaskListTokenizer && {
    ...stockTaskListTokenizer,
    tokenize: (src, tokens, lexer) => {
      const lines = taskListLines(src);
      return lines === null ? undefined : stockTaskListTokenizer.tokenize(lines, tokens, lexer);
    },
  },
});

// GFM numbers list items with 1 to 9 digits only.
const GFM_ORDERED_ITEM = /^[ \t]*\d{1,9}[.)](?:[ \t]|$)/;
// A numbered item: its indentation, number and delimiter, the spaces before its text, the text.
const NUMBERED_LINE = /^([ \t]*)(\d{1,9}[.)])( +)(.*)$/;
const stockOrderedTokenizer = OrderedList.config.markdownTokenizer;

/** The first `count` lines of `src`, without the line break after them. */
function firstLines(src: string, count: number): string {
  let end = -1;
  for (let line = 0; line < count; line++) {
    end = src.indexOf("\n", end + 1);
    if (end === -1) return src;
  }
  return src.slice(0, end);
}

/**
 * TipTap's reader takes the text of a numbered item to start right after "1." instead of after
 * the space that follows: every line under the item kept one space too many. A code block in a
 * numbered list got one more space at each opening, and a checklist in it fell apart. With one
 * more digit per space ("1. " written "01. "), its count is right; the number stays the same.
 */
function padNumbers(lines: string): string {
  return lines
    .split("\n")
    .map((line) => {
      const match = NUMBERED_LINE.exec(line);
      if (!match) return line;
      const [, indent, marker, spaces, text] = match;
      // GFM: after 5 spaces or more, or with no text, the item's text starts after one space.
      const width = spaces.length >= 5 || !text ? 1 : spaces.length;
      return `${indent}${"0".repeat(width)}${marker}${spaces}${text}`;
    })
    .join("\n");
}

/**
 * Ordered list read the GFM way.
 * - TipTap's own reader also takes letters and roman numerals as numbers: « M. Dupont »,
 *   « Cf. le document » or « a) option » became list items and lost their first word.
 *   Only digits open a list here.
 * - An item whose text is empty ("2. ", possibly with sub-items) is read back with its empty
 *   paragraph: the stock parser made it invalid, and it was dropped on the next save.
 */
const SafeOrderedList = OrderedList.extend({
  // No lettered or roman lists (TipTap makes some from a pasted « a) … b) … »): GFM can only
  // write digits, so such a list could not be read back. It is numbered 1., 2., … instead.
  addAttributes() {
    const attributes: Record<string, unknown> = { ...this.parent?.() };
    delete attributes.type;
    return attributes as ReturnType<NonNullable<typeof this.parent>>;
  },
  markdownTokenizer: stockOrderedTokenizer && {
    ...stockOrderedTokenizer,
    tokenize: (src, tokens, lexer) => {
      if (!GFM_ORDERED_ITEM.test(src)) return undefined;
      // Only the lines the list may take are padded: a few more at each try, as the stock
      // reader does, so a long note is not copied again at each of its lists.
      for (let count = 64; ; count *= 2) {
        const lines = firstLines(src, count);
        const token = stockOrderedTokenizer.tokenize(padNumbers(lines), tokens, lexer);
        if (!token) return undefined;
        const used = (token.raw ?? "").split("\n").length;
        // `raw` tells the reader how far the list goes: the lines as written, without the zeros.
        if (used < count || lines.length === src.length) return { ...token, raw: firstLines(src, used) };
      }
    },
  },
  parseMarkdown(token, helpers) {
    const parsed = this.parent?.(token, helpers);
    for (const list of Array.isArray(parsed) ? parsed : [parsed]) {
      for (const item of (list as JSONContent | undefined)?.content ?? []) tidyListItem(item);
    }
    return parsed as ReturnType<NonNullable<typeof this.parent>>;
  },
});

/** The destination of a Markdown link, inside <…> when a space, a parenthesis, "<" or ">"
 * would otherwise end it early. */
export function linkDestination(href: string): string {
  if (!/[\s()<>]/.test(href)) return href;
  return `<${href.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\n/g, "")}>`;
}

const SafeLink = Link.extend({
  renderMarkdown(node, helpers) {
    const href = linkDestination((node.attrs?.href as string | undefined) ?? "");
    const title = (node.attrs?.title as string | null | undefined) ?? "";
    const text = helpers.renderChildren(node);
    return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`;
  },
});

/**
 * A Markdown parser for one editor. @tiptap/markdown adds its tokenizers to the parser it is
 * given each time an editor is created: with the shared default parser, they piled up with
 * every note opened and slowed down the next openings.
 * The parser also leaves bare URLs and e-mail addresses as text (no GFM "autolinks"): the
 * editor writes a real link as [text](url), so text that only looks like a URL stays text.
 */
function createParser(): typeof marked {
  const parser = new Marked();
  parser.use({ tokenizer: { url: () => undefined } });
  // A Marked instance has everything @tiptap/markdown uses from the default one.
  return parser as unknown as typeof marked;
}

/** Paragraph whose text never turns into a list, heading or quote when read back. */
const SafeParagraph = Paragraph.extend({
  renderMarkdown(node, helpers, context) {
    // The table renderer passes the table as parent of the paragraphs of its cells.
    return escapeBlockStarts(this.parent?.(node, helpers, context) ?? "", context?.parentType === "table");
  },
});

export function createRichExtensions(options: RichExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      paragraph: false,
      // Replaced by CodeBlockLowlight (syntax highlighting).
      codeBlock: false,
      // No underline in Markdown, so not offered (docs/05).
      underline: false,
      // Replaced by the versions below, which read and write Markdown more safely.
      link: false,
      orderedList: false,
      listItem: false,
    }),
    SafeParagraph,
    SafeListItem,
    SafeOrderedList,
    SafeLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    SafeTaskList,
    SafeTaskItem.configure({ nested: true }),
    TableKit.configure({ table: false, tableCell: false, tableHeader: false }),
    TidyTable.configure({ resizable: false }),
    InlineTableCell,
    InlineTableHeader,
    options.codeBlock ?? baseCodeBlock,
    Placeholder.configure({ placeholder: "Écris quelque chose…" }),
    Markdown.configure({ marked: createParser(), indentation: { style: "space", size: 2 } }),
    ...(options.extra ?? []),
  ];
}
