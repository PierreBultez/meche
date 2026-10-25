// The rich editor writes the Markdown of the imported notes: the same rules as for a note typed
// in Mèche (docs/05), escapes included. Each note is checked on the way: its Markdown must read
// back as exactly the converted document, and keep all the text of the original note.
import { Editor, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { createRichExtensions } from "../editor/extensions";

export interface WrittenNote {
  markdown: string;
  /** False when the Markdown does not read back the same, or when text was lost. */
  exact: boolean;
}

/** Whitespace aside, the same text: what the check compares. */
const visibleText = (value: string) => value.replace(/\s+/g, "");

/**
 * One editor, without a window, for a whole import (creating one per note would be slower).
 * `destroy()` once the import is planned.
 */
export class MarkdownWriter {
  private readonly editor = new Editor({ extensions: createRichExtensions() });

  get schema(): Schema {
    return this.editor.schema;
  }

  /**
   * The Markdown of `document`, checked against `sourceText` (the text of the original note).
   * Throws when the document does not fit the editor's schema.
   */
  write(document: JSONContent, sourceText: string): WrittenNote {
    const node = this.schema.nodeFromJSON(document);
    node.check();
    const markdown = this.serialize(node.toJSON() as JSONContent);
    const back = this.schema.nodeFromJSON(this.read(markdown));
    const exact =
      back.eq(node) &&
      this.serialize(back.toJSON() as JSONContent) === markdown &&
      visibleText(node.textContent) === visibleText(sourceText);
    return { markdown, exact };
  }

  /** The document the editor reads from `markdown` (as when the note is opened). */
  read(markdown: string): JSONContent {
    return this.manager().parse(markdown);
  }

  destroy(): void {
    this.editor.destroy();
  }

  /** Like `serializeMarkdown` (editor/serialize.ts): no blank lines at the end. */
  private serialize(document: JSONContent): string {
    return this.manager().serialize(document).replace(/\n+$/, "");
  }

  private manager() {
    const manager = this.editor.markdown;
    if (!manager) throw new Error("the Markdown extension is missing");
    return manager;
  }
}
