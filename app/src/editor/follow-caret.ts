// Where the caret goes when an editor shows another version of its note (docs/04, « affiche la
// version enregistrée sur place »). The editor maps the caret through the change; but when the
// change covers the caret (the other device wrote before AND after it), the mapping puts it at
// one end of the change, far from where you were typing. If the paragraph (or line) holding the
// caret is still there, unchanged, the caret goes back into it, at the same place.
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

interface Block {
  /** Position where the block's content starts, and where it ends. */
  start: number;
  end: number;
  text: string;
}

/** The text blocks (paragraphs, headings, cells' paragraphs…) of a document, in order. */
function textBlocks(doc: ProseMirrorNode): Block[] {
  const blocks: Block[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    blocks.push({ start: position + 1, end: position + node.nodeSize - 1, text: node.textContent });
    // A text block holds only inline content: nothing more to look for inside.
    return false;
  });
  return blocks;
}

/**
 * The block (or line) of `after` matching block `index` of `before`, or -1: among the ones with
 * the same text, the one of the same rank when there are as many as before (« the second Lait »
 * stays the second), else the nearest.
 */
function matching(before: string[], index: number, after: string[]): number {
  const text = before[index];
  const candidates = after.flatMap((candidate, i) => (candidate === text ? [i] : []));
  if (candidates.length === 0) return -1;
  const same = before.filter((candidate) => candidate === text);
  if (candidates.length === same.length) {
    return candidates[before.slice(0, index).filter((candidate) => candidate === text).length];
  }
  return candidates.reduce((best, i) => (Math.abs(i - index) < Math.abs(best - index) ? i : best));
}

/**
 * Rich editor: the caret was at `caret` in `before`; the editor mapped it to `mapped` in
 * `after`. Returns where it should be.
 */
export function followCaretInDocument(
  before: ProseMirrorNode,
  caret: number,
  after: ProseMirrorNode,
  mapped: number,
): number {
  const $caret = before.resolve(caret);
  if (!$caret.parent.isTextblock) return mapped;
  const text = $caret.parent.textContent;
  const $mapped = after.resolve(Math.min(mapped, after.content.size));
  if ($mapped.parent.isTextblock && $mapped.parent.textContent === text) return mapped;
  const blocksBefore = textBlocks(before);
  const index = blocksBefore.findIndex((block) => block.start === $caret.start());
  const blocks = textBlocks(after);
  const found = matching(
    blocksBefore.map((block) => block.text),
    index,
    blocks.map((block) => block.text),
  );
  if (found === -1) return mapped;
  return Math.min(blocks[found].start + $caret.parentOffset, blocks[found].end);
}

/** Code editor: the same, line by line, with positions in the text. */
export function followCaretInText(before: string, caret: number, after: string, mapped: number): number {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const { line, column } = lineAt(before, caret);
  const text = beforeLines[line];
  if (afterLines[lineAt(after, mapped).line] === text) return mapped;
  const found = matching(beforeLines, line, afterLines);
  if (found === -1) return mapped;
  const start = afterLines.slice(0, found).reduce((length, current) => length + current.length + 1, 0);
  return start + column;
}

/** Line number and column of a position in a text. */
function lineAt(text: string, position: number): { line: number; column: number } {
  const head = text.slice(0, position);
  const line = head.split("\n").length - 1;
  return { line, column: position - (head.lastIndexOf("\n") + 1) };
}
