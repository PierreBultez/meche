// TipTap extensions of rich notes (docs/05). Only MIT packages published on npm.
// The same list is used by the editor and by the Markdown tests, so both share one schema.
import type { AnyExtension } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableKit, renderTableToMarkdown } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import Paragraph from "@tiptap/extension-paragraph";
import StarterKit from "@tiptap/starter-kit";
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
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
    SafeParagraph,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: false }),
    TidyTable.configure({ resizable: false }),
    options.codeBlock ?? baseCodeBlock,
    Placeholder.configure({ placeholder: "Écris quelque chose…" }),
    Markdown.configure({ indentation: { style: "space", size: 2 } }),
    ...(options.extra ?? []),
  ];
}
