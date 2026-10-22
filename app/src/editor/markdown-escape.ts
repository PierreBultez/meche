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
  // "1. item", "1) item", and what TipTap's list reader also takes for a number: letters and
  // roman numerals (« M. Dupont », « Cf. ceci », « a) option », « IV. Titre »), long numbers
  [/^(\s*)(\d+|[a-zA-Z]{1,2}|[ivxlcdmIVXLCDM]+)([.)])(\s|$)/, "$1$2\\$3$4"],
  // "# heading"
  [/^(\s*)(#{1,6})(\s|$)/, "$1\\$2$3"],
  // "> quote"
  [/^(\s*)>/, "$1\\>"],
  // "```" or "~~~" code fences
  [/^(\s*)(`{3,}|~{3,})/, "$1\\$2"],
  // "---", "--", "=" (thematic break, setext heading underline after a line break)
  [/^(\s*)([-=])(\2*\s*)$/, "$1\\$2$3"],
];

/** Rules for the lines of a paragraph outside table cells (a cell is one trimmed line). */
const LINE_STARTS: Array<[RegExp, string]> = [
  // Leading spaces or tabs before some text: read back, they would be dropped, or make an
  // indented code block from 4 on. The first one is written as an entity, so the line no longer
  // starts with one.
  [/^ (?=[ \t]*\S)/, "&#32;"],
  [/^\t(?=[ \t]*\S)/, "&#9;"],
  // A line that is only the "  " of a second line break in a row would be read as a blank line,
  // ending the paragraph: it is written as the other form of line break, a backslash.
  [/^ {2}$/, "\\"],
];

export function escapeBlockStarts(markdown: string, inTableCell = false): string {
  const rules = inTableCell ? BLOCK_STARTS : [...BLOCK_STARTS, ...LINE_STARTS];
  return markdown
    .split("\n")
    .map((line) => rules.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), line))
    .join("\n");
}
