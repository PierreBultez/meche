import type { Editor } from "@tiptap/core";

/**
 * The Markdown saved for a rich note. TipTap always keeps an empty paragraph at the end of the
 * document (so one can click below a table or a code block); it would add blank lines at the
 * end of every saved note, and mark a note as modified as soon as it is clicked. Trailing
 * blank lines carry no meaning in Markdown, so they are dropped.
 */
export function serializeMarkdown(editor: Editor): string {
  return editor.getMarkdown().replace(/\n+$/, "");
}
