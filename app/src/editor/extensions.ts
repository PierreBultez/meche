// TipTap extensions of rich notes (docs/05). Only MIT packages published on npm.
// The same list is used by the editor and by the Markdown tests, so both share one schema.
import type { AnyExtension, JSONContent } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Link from "@tiptap/extension-link";
import { OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
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

/** Table without the blank lines the default renderer adds around it (one even at the very
 * start of a note that begins with a table). */
const TidyTable = Table.extend({
  renderMarkdown(node, helpers) {
    return renderTableToMarkdown(node, helpers).replace(/^\n+|\n+$/g, "");
  },
});

/** GFM stores a table cell on one line: no list, heading or code block in a cell. A cell keeps
 * several paragraphs (written with <br>), so Entrée still works in it. */
const InlineTableCell = TableCell.extend({ content: "paragraph+" });
const InlineTableHeader = TableHeader.extend({ content: "paragraph+" });

/** Ordered list whose empty items ("2. ") are read back as empty items, like bullet lists;
 * the stock parser made them invalid, and they were dropped on the next save. */
const SafeOrderedList = OrderedList.extend({
  parseMarkdown(token, helpers) {
    const parsed = this.parent?.(token, helpers);
    for (const list of Array.isArray(parsed) ? parsed : [parsed]) {
      for (const item of (list as JSONContent | undefined)?.content ?? []) {
        if (item.type === "listItem" && !item.content?.length) item.content = [{ type: "paragraph" }];
      }
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
    return escapeBlockStarts(this.parent?.(node, helpers, context) ?? "");
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
    }),
    SafeParagraph,
    SafeOrderedList,
    SafeLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
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
