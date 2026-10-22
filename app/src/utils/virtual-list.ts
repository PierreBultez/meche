// A virtual list draws only the rows in view (docs/08: the note list stays fast with
// thousands of notes). Every row has the same height, measured on the first one drawn.

/** Rows to draw, from `start` (included) to `end` (excluded), with a margin above and below. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 5,
): { start: number; end: number } {
  if (count === 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const inView = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  // Never start past the last screenful, even with an outdated scroll position.
  const start = Math.max(0, Math.min(first, count - inView) - overscan);
  const end = Math.min(count, Math.max(first, start) + inView + overscan);
  return { start, end };
}

/** The scroll position that shows row `index` entirely, moving as little as possible,
 * or null when it is already in view. */
export function scrollToShow(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return bottom - viewportHeight;
  return null;
}
