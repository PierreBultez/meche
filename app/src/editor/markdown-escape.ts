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
  // "---", "--", "=" (thematic break, setext heading underline after a line break), and dashes
  // with spaces between them ("- - -", "-- ------ ----"), also a thematic break in Markdown
  [/^(\s*)([-=])((?:\2|[ \t])*)$/, "$1\\$2$3"],
];

/**
 * The line under a table's header in GFM ("|---|---|", "--- | :---:", and for one column "|---",
 * ":---", "---|", ":-:"): with it, the line above would become a table. Its pipes are escaped, or
 * its first colon when it has no pipe. Each pattern can only go forward, never back: a long line
 * of spaces costs a time proportional to its length (security review, phase 4).
 */
const TABLE_DELIMITER_ROW = /^\s*(?:\|\s*)?:?-+:?\s*(?:\|\s*:?-+:?\s*)+(?:\|\s*)?$/;
const ONE_COLUMN_DELIMITER_ROW = /^\s*(?:\|\s*)?:?-+:?\s*(?:\|\s*)?$/;

function escapeTableDelimiter(line: string): string {
  const delimiter =
    TABLE_DELIMITER_ROW.test(line) || (ONE_COLUMN_DELIMITER_ROW.test(line) && /[|:]/.test(line));
  if (!delimiter) return line;
  return line.includes("|") ? line.replace(/\|/g, "\\|") : line.replace(":", "\\:");
}

/** Rules for the lines of a paragraph outside table cells (a cell is one trimmed line). */
const LINE_STARTS: Array<[RegExp, string]> = [
  // Leading spaces or tabs: read back, they would be dropped, make an indented code block from
  // 4 on, or (a line of spaces only) end the paragraph. The first one is written as an entity,
  // so the line no longer starts with one.
  [/^ /, "&#32;"],
  [/^\t/, "&#9;"],
];

export function escapeBlockStarts(markdown: string, inTableCell = false): string {
  const rules = inTableCell ? BLOCK_STARTS : [...BLOCK_STARTS, ...LINE_STARTS];
  const lines = markdown.split("\n");
  return lines
    .map((line, index) => {
      // A line that is only "  " is the mark of a second line break in a row. Followed by more
      // text, it is written as the other form of line break, a backslash (spaces alone would be
      // read as a blank line). At the end of the paragraph a backslash would show as text: the
      // spaces are kept, the first one as an entity.
      if (!inTableCell && line === "  ") return lines[index + 1] ? "\\" : "&#32; ";
      const unpiped = inTableCell ? line : escapeTableDelimiter(line);
      return rules.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), unpiped);
    })
    .join("\n");
}
