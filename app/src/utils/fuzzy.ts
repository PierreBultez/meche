/** Lowercase, without accents: « Épinglées » → « epinglees ». */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Fuzzy score of `text` for `query` (command palette): every character of the query must appear
 * in order. Consecutive characters and characters at the start of a word score higher.
 * Returns null when the text does not match. Accents and case are ignored.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const wanted = fold(query.replace(/\s+/g, ""));
  const target = fold(text);
  if (wanted === "") return 0;
  let score = 0;
  let position = 0;
  let previous = -2;
  for (const char of wanted) {
    const found = target.indexOf(char, position);
    if (found === -1) return null;
    const wordStart = found === 0 || /[\s\-–:/]/.test(target[found - 1]);
    score += 1 + (found === previous + 1 ? 3 : 0) + (wordStart ? 2 : 0);
    previous = found;
    position = found + 1;
  }
  // Shorter texts win among equal matches.
  return score - target.length * 0.01;
}

const words = (text: string): string[] => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * True when every word of the query starts a word of the text: « nouv code » matches
 * « Nouvelle note code ». The palette shows these actions before the notes.
 */
export function matchesWordStarts(query: string, text: string): boolean {
  const wanted = words(query);
  const available = words(text);
  return (
    wanted.length > 0 && wanted.every((part) => available.some((word) => word.startsWith(part)))
  );
}

/**
 * Sorts `items` for the command palette, best first: `strong` matches every query word at a
 * word start, `weak` only matches fuzzily. Items that do not match are left out.
 */
export function rankByQuery<T>(
  query: string,
  items: readonly T[],
  text: (item: T) => string,
): { strong: T[]; weak: T[] } {
  if (query.trim() === "") return { strong: [...items], weak: [] };
  const scored = items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score);
  const strong: T[] = [];
  const weak: T[] = [];
  for (const { item } of scored) {
    (matchesWordStarts(query, text(item)) ? strong : weak).push(item);
  }
  return { strong, weak };
}
