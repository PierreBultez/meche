/**
 * WCAG 2.x contrast helpers. Pure functions, used by the automated contrast test.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Minimum ratio for body text (WCAG AA). */
export const MIN_TEXT = 4.5;
/** Minimum ratio for large titles, icons and UI graphics (WCAG AA). */
export const MIN_LARGE = 3;

/** Parses `#rrggbb` or `#rrggbbaa` (the alpha channel is ignored). */
export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) {
    throw new Error(`Not a #rrggbb color: "${hex}"`);
  }
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

function linearChannel(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

/** Contrast ratio between two colors, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Same result as CSS `color-mix(in srgb, a <share>%, b)`, with `share` between 0 and 1. */
export function mixSrgb(a: Rgb, b: Rgb, share: number): Rgb {
  return {
    r: a.r * share + b.r * (1 - share),
    g: a.g * share + b.g * (1 - share),
    b: a.b * share + b.b * (1 - share),
  };
}
