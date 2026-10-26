// TipTap extensions of rich notes (docs/05). Only MIT packages published on npm.
// The same list is used by the editor and by the Markdown tests, so both share one schema.
import { decodeHtmlEntities, type AnyExtension, type JSONContent } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Heading from "@tiptap/extension-heading";
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
import { Marked, Tokenizer, type marked } from "marked";
import { codeFence } from "../utils/code-fence";
import { lowlight } from "./lowlight";
import { escapeBlockStarts, escapeClosingHashes } from "./markdown-escape";

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
  renderMarkdown(node, helpers, context) {
    const table = renderTableToMarkdown(node, helpers).replace(/^\n+|\n+$/g, "");
    // Right after a sub-list in an item, its rows would continue the last sub-item's text: a
    // blank line separates them.
    const afterList = ["bulletList", "orderedList", "taskList"].includes(context?.previousNode?.type ?? "");
    return afterList && ["listItem", "taskItem"].includes(context?.parentType ?? "") ? `\n${table}` : table;
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
  if (item.type !== "listItem" && item.type !== "taskItem") return;
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

/** A token of marked, as much as these readers need of it. */
interface BlockToken {
  type: string;
  tokens?: unknown[];
}

/**
 * Inside a list item, marked gives the text of a tight list as `text` tokens, not paragraphs,
 * and TipTap's Text node keeps such a token as raw text: a link or bold placed after a sub-list
 * came back as `[ici](…)` and `**vite**`, escaped once more at each save (review, phase 4). They
 * are read as the paragraphs they are.
 */
function textAsParagraphs<T>(tokens: T[] | undefined): T[] | undefined {
  return tokens?.map((token) => {
    const block = token as BlockToken;
    return block.type === "text" && Array.isArray(block.tokens) ? ({ ...block, type: "paragraph" } as T) : token;
  });
}

/**
 * marked reads "[ ] " or "[x] " at the start of an item as a checkbox, which a numbered or bullet
 * item cannot show: the editor dropped it with no trace (« 1. [ ] Acheter » became « Acheter »).
 * It is kept as the text it was, in front of the item's text.
 */
function boxesAsText<T>(tokens: T[] | undefined): T[] | undefined {
  if (!tokens) return tokens;
  const result: T[] = [];
  let box: string | null = null;
  for (const token of tokens) {
    const block = token as BlockToken & { raw?: string; text?: string };
    if (block.type === "checkbox") {
      box = block.raw ?? "";
    } else if (box !== null && block.type === "text") {
      const prefix = { type: "text", raw: box, text: box };
      result.push({ ...block, raw: box + (block.raw ?? ""), text: box + (block.text ?? ""), tokens: [prefix, ...(block.tokens ?? [])] } as T);
      box = null;
    } else {
      result.push(token);
    }
  }
  // A box with no text after it.
  if (box !== null) result.push({ type: "text", raw: box, text: box, tokens: [{ type: "text", raw: box, text: box }] } as T);
  return result;
}

interface InlineToken extends BlockToken {
  raw?: string;
  text?: string;
}

/**
 * TipTap joins the pieces of text of a paragraph with one splice per piece, a time growing with
 * the square of their number: a paragraph of 8,000 lines full of escapes (`\[`, `\_`), as a
 * pasted log becomes, took 4 s to open. Each run of text and escape tokens is joined here first,
 * in one pass, into one `escape` token, whose text TipTap keeps as it is: the text tokens are
 * decoded beforehand, as TipTap decodes them (`\&amp;` stays « &amp; »).
 */
function joinTextRuns<T>(tokens: T[] | undefined): T[] | undefined {
  if (!tokens) return tokens;
  const result: T[] = [];
  let run: InlineToken[] = [];
  const flush = () => {
    if (run.length === 1) result.push(run[0] as T);
    if (run.length > 1) {
      const raw = run.map((token) => token.raw ?? "").join("");
      const text = run.map((token) => (token.type === "text" ? decodeHtmlEntities(token.text ?? "") : (token.text ?? ""))).join("");
      result.push({ type: "escape", raw, text } as T);
    }
    run = [];
  };
  for (const token of tokens) {
    const inline = token as InlineToken;
    if ((inline.type === "text" || inline.type === "escape") && !inline.tokens) {
      run.push(inline);
    } else {
      flush();
      result.push(token);
    }
  }
  flush();
  return result;
}

/**
 * A blank line above each `---` line that comes right under a line of text, outside code blocks:
 * Markdown would read that text as a heading, underlined by the rule (`- a⏎  ---`). Paragraphs
 * cannot hold such a line themselves (SafeParagraph writes `\---`).
 */
// The line of an empty item: its marker alone ("-", "10.", "- [ ]"). A rule under it is in the
// item already; a blank line there would take the rule out of the list.
const BARE_MARKER = /^(?:[-+*]|\d{1,9}[.)])(?: \[[ xX]\])?$/;

function separateRules(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const marks = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fence) {
      // A fence closes with the same character, at least as many times, and nothing after.
      if (marks && marks[0] === fence[0] && marks.length >= fence.length && trimmed === marks) fence = null;
    } else if (marks) {
      fence = marks;
    } else if (trimmed === "---" && index > 0 && lines[index - 1].trim() && !BARE_MARKER.test(lines[index - 1].trim())) {
      result.push("");
    }
    result.push(line);
  });
  return result.join("\n");
}

/**
 * The lines right after the first line of an item, one per line break of its own text, indented
 * under its text by `width` spaces. Not indented, such a line can end the item: one starting with
 * `#` does in a list item, any line does in a checklist (review, phase 4).
 */
function indentLineBreaks(markdown: string, item: JSONContent, width: number): string {
  const text = item.content?.[0];
  const breaks = text?.type === "paragraph" ? (text.content ?? []).filter((child) => child.type === "hardBreak").length : 0;
  if (!breaks) return markdown;
  const indent = " ".repeat(width);
  return markdown
    .split("\n")
    .map((line, index) => (index >= 1 && index <= breaks && line ? `${indent}${line}` : line))
    .join("\n");
}

const isList = (node: JSONContent | undefined) => node?.type === "bulletList" || node?.type === "orderedList";

/** A list item whose text is empty (it may have sub-items). */
function isEmptyItem(item: JSONContent | undefined): boolean {
  return item?.type === "listItem" && item.content?.[0]?.type === "paragraph" && !item.content[0].content?.length;
}

const SafeListItem = ListItem.extend({
  renderMarkdown(node, helpers, context) {
    let markdown = this.parent?.(node, helpers, context) ?? "";
    // An empty item is written "-" or "1." alone on its line: marked reads "- " or "1. " followed
    // by a line break as a paragraph (the sub-items moved up a level, a first empty item turned
    // the whole list into text).
    markdown = markdown.replace(/^(-|\d+\.) (?=\n|$)/, "$1");
    // Its line breaks: indented under the text, "- " or "1. " wide.
    markdown = indentLineBreaks(markdown, node, /^(-|\d+\.) ?/.exec(markdown)?.[0].length ?? 2);
    // Right under this item's text, an empty sub-item ("-") would underline it as a heading, and
    // "1." would join it: a blank line separates them, as for a horizontal rule.
    const [text, next] = node.content ?? [];
    if (text?.type === "paragraph" && text.content?.length && isList(next) && isEmptyItem(next?.content?.[0])) {
      markdown = markdown.replace(/\n([ \t]*(?:-|\d{1,9}\.))(?=\n|$)/, "\n\n$1");
    }
    if (node.content?.some((child) => child.type === "horizontalRule")) markdown = separateRules(markdown);
    return markdown;
  },
  parseMarkdown(token, helpers) {
    const parsed = this.parent?.({ ...token, tokens: textAsParagraphs(boxesAsText(token.tokens)) }, helpers);
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
    // One line of Markdown per line break of the item's own text, right after its first line.
    const markdown = indentLineBreaks(this.parent?.(node, helpers, context) ?? "", node, 2);
    return node.content?.some((child) => child.type === "horizontalRule") ? separateRules(markdown) : markdown;
  },
  parseMarkdown(token, helpers) {
    const parsed = this.parent?.({ ...token, nestedTokens: textAsParagraphs(token.nestedTokens) }, helpers) as JSONContent;
    tidyListItem(parsed);
    const [first, second, ...rest] = parsed.content ?? [];
    const last = first?.content?.[first.content.length - 1];
    // Two spaces at the end of the first line: the mark of a line break. The next lines come as
    // a paragraph of their own: they are put back into the first one.
    const spaces = last?.type === "text" ? trailingSpaces(last.text ?? "") : 0;
    if (first?.type !== "paragraph" || second?.type !== "paragraph" || spaces < 2) return parsed;
    const firstLine = [...(first.content ?? []).slice(0, -1), { ...last, text: (last?.text ?? "").slice(0, -spaces) }];
    const joined = [...firstLine, { type: "hardBreak" }, ...(second.content ?? [])].filter(
      (child) => child.type !== "text" || child.text,
    );
    return { ...parsed, content: [{ ...first, content: joined }, ...rest] };
  },
});

// The line pattern of TipTap's task list reader.
const TASK_ITEM_LINE = /^\s*[-+*]\s+\[[ xX]\]\s+/;
const stockTaskListTokenizer = TaskList.config.markdownTokenizer;

/**
 * The lines a task list starting at the beginning of `src` can take, or null when it does not
 * start with one (after blank lines, which the stock reader skips). The list never goes past a
 * line that is not indented and is not a task, nor past a blank line followed by a line that is
 * not indented: the text is cut right before it.
 */
function taskListLines(src: string): string | null {
  let start = 0;
  let started = false;
  let afterBlank = false;
  while (start < src.length) {
    const line = lineAt(src, start);
    if (line.trim()) {
      if (!started) {
        if (!TASK_ITEM_LINE.test(line)) return null;
        started = true;
      } else if (/^\S/.test(line) && (afterBlank || !TASK_ITEM_LINE.test(line))) {
        return src.slice(0, start);
      }
      afterBlank = false;
    } else if (started) {
      afterBlank = true;
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

/**
 * Ordered list read by marked's own GFM list reader, like bullet lists. TipTap's reader took any
 * line that looks like a number ("1.", "a)", « M. Dupont ») for a new item, even inside a code
 * block or a sub-list, and started an item's text one space too early: code was lost, a table
 * became text, blocks moved a level, a word was eaten (reviews, phase 4). GFM only takes 1 to 9
 * digits.
 */
const SafeOrderedList = OrderedList.extend({
  // No lettered or roman lists (TipTap makes some from a pasted « a) … b) … »): GFM can only
  // write digits, so such a list could not be read back. It is numbered 1., 2., … instead.
  addAttributes() {
    const attributes: Record<string, unknown> = { ...this.parent?.() };
    delete attributes.type;
    return attributes as ReturnType<NonNullable<typeof this.parent>>;
  },
  // No reader of its own: the `list` tokens come from marked.
  markdownTokenizer: { name: "orderedList", level: "block", start: () => -1, tokenize: () => undefined },
  parseMarkdown(token, helpers) {
    if (token.type !== "list" || !token.ordered) return [];
    // Each item goes through SafeListItem, which reads all of its Markdown (TipTap's own reading
    // of numbered items also kept raw text).
    const content = helpers.parseChildren((token.items ?? []) as never[]);
    const start = typeof token.start === "number" ? token.start : 1;
    return start === 1 ? { type: "orderedList", content } : { type: "orderedList", attrs: { start }, content };
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

// A list item marker followed only by spaces or tabs, on the first line.
const EMPTY_FIRST_ITEM = /^( {0,3}(?:[*+-]|\d{1,9}[.)]))[ \t]+(?=\n|$)/;

/**
 * A Markdown parser for one editor. @tiptap/markdown adds its tokenizers to the parser it is
 * given each time an editor is created: with the shared default parser, they piled up with
 * every note opened and slowed down the next openings.
 * The parser also leaves bare URLs and e-mail addresses as text (no GFM "autolinks"): the
 * editor writes a real link as [text](url), so text that only looks like a URL stays text.
 */
function createParser(): typeof marked {
  const parser = new Marked();
  parser.use({
    tokenizer: {
      url: () => undefined,
      // An empty first item followed by a space ("1. ", "- "), as the editor wrote it before
      // phase 4, does not start a list for marked: the note reopened as plain text. The list is
      // read without that space; `raw` still covers it, so the reader goes on at the right place.
      list(src) {
        const empty = EMPTY_FIRST_ITEM.exec(src);
        if (!empty) return false;
        const marker = empty[1];
        // `call(this, …)`: marked's own list reader, with this tokenizer as its `this`.
        const token = Tokenizer.prototype.list.call(this, marker + src.slice(empty[0].length));
        return token ? { ...token, raw: empty[0] + token.raw.slice(marker.length) } : false;
      },
    },
  });
  // A Marked instance has everything @tiptap/markdown uses from the default one.
  return parser as unknown as typeof marked;
}

/** Heading whose text keeps a « #» at its end when read back (`## Langage C \\#`). */
const SafeHeading = Heading.extend({
  renderMarkdown(node, helpers, context) {
    const markdown = this.parent?.(node, helpers, context) ?? "";
    // "## " then the text: only the text is looked at.
    const space = markdown.indexOf(" ");
    return space === -1 ? markdown : markdown.slice(0, space + 1) + escapeClosingHashes(markdown.slice(space + 1));
  },
});

/** Paragraph whose text never turns into a list, heading or quote when read back. */
const SafeParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    return this.parent?.({ ...token, tokens: joinTextRuns(token.tokens) }, helpers) as ReturnType<NonNullable<typeof this.parent>>;
  },
  renderMarkdown(node, helpers, context) {
    // The table renderer passes the table as parent of the paragraphs of its cells.
    const markdown = escapeBlockStarts(this.parent?.(node, helpers, context) ?? "", context?.parentType === "table");
    // A line or paragraph separator (U+2028, U+2029, pasted) stopped TipTap's readers of list
    // items, which read an item up to the end of its line: written as an entity, it reads back as
    // the same character. (In inline code it would show as the entity: such code is unlikely.)
    return markdown.replace(/\u2028/g, "&#8232;").replace(/\u2029/g, "&#8233;");
  },
});

export function createRichExtensions(options: RichExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      // Replaced by SafeHeading, levels 1 to 3 (docs/05).
      heading: false,
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
    SafeHeading.configure({ levels: [1, 2, 3] }),
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
