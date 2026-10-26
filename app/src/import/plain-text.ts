// Plain text notes of Standard Notes. They are not Markdown (docs/07): a `*`, a `#` or a `<`
// typed there must stay exactly as typed. The text becomes paragraphs of the rich editor, and
// the editor escapes every character that Markdown would read otherwise.
import type { JSONContent } from "@tiptap/core";
import { doc, linesToInline, paragraph } from "./doc";

/** An empty line (or a line of spaces) separates two paragraphs; each line break is kept. */
export function plainTextToDoc(source: string): JSONContent {
  const paragraphs: JSONContent[] = [];
  let current: string[] = [];
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim()) {
      current.push(line);
    } else if (current.length) {
      paragraphs.push(paragraph(linesToInline(current)));
      current = [];
    }
  }
  if (current.length) paragraphs.push(paragraph(linesToInline(current)));
  return doc(paragraphs);
}
