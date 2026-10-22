/**
 * Escapes Markdown block syntax at the start of each line of a rendered paragraph.
 *
 * @tiptap/markdown escapes inline characters (*, _, [) but not block markers: a paragraph whose
 * text starts with "1. " or "- " (pasted text, an undone list) would be read back as a list,
 * changing the note's structure on the next opening. Escaping the marker keeps it plain text.
 */
const BLOCK_STARTS: Array<[RegExp, string]> = [
  // "- item", "+ item", or a lone "-" (a "*" is already escaped by the inline rules)
  [/^(\s*)([-+])(\s|$)/, "$1\\$2$3"],
  // "1. item", "1) item"
  [/^(\s*)(\d{1,9})([.)])(\s|$)/, "$1$2\\$3$4"],
  // "# heading"
  [/^(\s*)(#{1,6})(\s|$)/, "$1\\$2$3"],
  // "> quote"
  [/^(\s*)>/, "$1\\>"],
  // "```" or "~~~" code fences
  [/^(\s*)(`{3,}|~{3,})/, "$1\\$2"],
  // "---", "--", "=" (thematic break, setext heading underline after a line break)
  [/^(\s*)([-=])(\2*\s*)$/, "$1\\$2$3"],
  // Leading spaces or tabs: read back, they would be dropped, or make an indented code block
  // from 4 on. The first one is written as an entity, so the line no longer starts with one.
  [/^ /, "&#32;"],
  [/^\t/, "&#9;"],
];

export function escapeBlockStarts(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => BLOCK_STARTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), line))
    .join("\n");
}
