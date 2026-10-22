import { mixSrgb, parseHex, type Rgb } from "./contrast";

export type ThemeName = "light" | "dark";

/** Raw token declarations of one theme, e.g. { bg: "#ffffff", "note-violet-card": "var(…)" }. */
export type TokenMap = Record<string, string>;

const LIGHT_SELECTOR = ":root";
const DARK_SELECTOR = ':root[data-theme="dark"]';

/**
 * Reads the two token blocks of tokens.css. The dark theme is applied on top of the light one
 * (both selectors match <html>), so the dark map contains every light token, overridden.
 */
export function parseTokens(css: string): { light: TokenMap; dark: TokenMap; darkOnly: TokenMap } {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = new Map<string, TokenMap>();
  for (const [, selector, body] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations: TokenMap = {};
    for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      declarations[name] = value.trim();
    }
    blocks.set(selector.trim(), declarations);
  }
  const light = blocks.get(LIGHT_SELECTOR);
  const darkOnly = blocks.get(DARK_SELECTOR);
  if (!light || !darkOnly) {
    throw new Error(`tokens.css must contain "${LIGHT_SELECTOR}" and "${DARK_SELECTOR}" blocks`);
  }
  return { light, dark: { ...light, ...darkOnly }, darkOnly };
}

/** Resolves a token to a concrete color, following var() and color-mix(in srgb, …). */
export function resolveColor(tokens: TokenMap, name: string, seen: string[] = []): Rgb {
  if (seen.includes(name)) {
    throw new Error(`Circular token reference: ${[...seen, name].join(" → ")}`);
  }
  const value = tokens[name];
  if (value === undefined) {
    throw new Error(`Unknown token --${name}`);
  }
  return resolveValue(tokens, value, [...seen, name]);
}

function resolveValue(tokens: TokenMap, value: string, seen: string[]): Rgb {
  if (value.startsWith("#")) {
    return parseHex(value);
  }
  const reference = /^var\(--([\w-]+)\)$/.exec(value);
  if (reference) {
    return resolveColor(tokens, reference[1], seen);
  }
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/.exec(value);
  if (mix) {
    const [, first, percent, second] = mix;
    return mixSrgb(
      resolveValue(tokens, first, seen),
      resolveValue(tokens, second, seen),
      Number(percent) / 100,
    );
  }
  throw new Error(`Unsupported token value: "${value}"`);
}
