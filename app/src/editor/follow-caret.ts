// Where the caret goes when an editor shows another version of its note (docs/04, « affiche la
// version enregistrée sur place »). The editor replaces one part of the text, from the first
// difference to the last, and maps the caret through it. When the other device wrote before AND
// after the caret, that part covers the caret, and the mapping puts it at one end, far from where
// you were typing. If the paragraph (or line) holding the caret was carried over unchanged inside
// that part, the caret goes back into it, at the same place.
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** The part replaced: from `from` to `to` in the old text, to `toNew` in the new one. */
export interface Replaced {
  from: number;
  to: number;
  toNew: number;
}

interface Block {
  /** Where the block's content starts and ends. */
  start: number;
  end: number;
  /** Compares two blocks exactly (text, marks, hard breaks…). */
  key: string;
}

/** The text blocks (paragraphs, headings, cells' paragraphs…) lying inside `from`…`to`. */
function textBlocks(doc: ProseMirrorNode, from: number, to: number): Block[] {
  const blocks: Block[] = [];
  doc.nodesBetween(from, to, (node, position) => {
    if (!node.isTextblock) return true;
    const start = position + 1;
    const end = position + node.nodeSize - 1;
    if (start >= from && end <= to) blocks.push({ start, end, key: JSON.stringify(node.toJSON()) });
    // A text block holds only inline content: nothing more to look for inside.
    return false;
  });
  return blocks;
}

/** The lines lying inside `from`…`to` of a text. */
function textLines(text: string, from: number, to: number): Block[] {
  const lines: Block[] = [];
  let start = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    if (start >= from && end <= to) lines.push({ start, end, key: line });
    start = end + 1;
  }
  return lines;
}

/**
 * The block of `after` matching block `index` of `before`, or -1: among the ones identical to
 * it, the one of the same rank when there are as many as before (« the second Lait » stays the
 * second), else the nearest.
 */
function matching(before: Block[], index: number, after: Block[]): number {
  const key = before[index].key;
  const candidates = after.flatMap((block, i) => (block.key === key ? [i] : []));
  if (candidates.length === 0) return -1;
  const same = before.filter((block) => block.key === key);
  if (candidates.length === same.length) {
    return candidates[before.slice(0, index).filter((block) => block.key === key).length];
  }
  return candidates.reduce((best, i) => (Math.abs(i - index) < Math.abs(best - index) ? i : best));
}

/** Where the caret goes, given the blocks of the part replaced before and after the change. */
function follow(caret: number, mapped: number, before: Block[], after: Block[]): number {
  const index = before.findIndex((block) => block.start <= caret && caret <= block.end);
  if (index === -1) return mapped;
  const found = matching(before, index, after);
  if (found === -1) return mapped;
  // The same content, so the same offset inside it.
  return after[found].start + (caret - before[index].start);
}

/** Rich editor: the caret was at `caret` in `before`, the editor mapped it to `mapped`. */
export function followCaretInDocument(
  before: ProseMirrorNode,
  caret: number,
  after: ProseMirrorNode,
  mapped: number,
  replaced: Replaced,
): number {
  // Outside the part replaced (or at its edge), the editor's mapping is right.
  if (caret <= replaced.from || caret >= replaced.to) return mapped;
  return follow(
    caret,
    mapped,
    textBlocks(before, replaced.from, replaced.to),
    textBlocks(after, replaced.from, replaced.toNew),
  );
}

/** Code editor: the same, line by line, with positions in the editor's text ("\n" only). */
export function followCaretInText(
  before: string,
  caret: number,
  after: string,
  mapped: number,
  replaced: Replaced,
): number {
  if (caret <= replaced.from || caret >= replaced.to) return mapped;
  return follow(
    caret,
    mapped,
    textLines(before, replaced.from, replaced.to),
    textLines(after, replaced.from, replaced.toNew),
  );
}
