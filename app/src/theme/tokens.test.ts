/**
 * Automated contrast check of the two themes (docs/11, "Contraste").
 * Reads tokens.css itself, so the colors tested are exactly the colors shipped.
 */
import { describe, expect, it } from "vitest";
import tokensCss from "../styles/tokens.css?raw";
import { MIN_LARGE, MIN_TEXT, contrastRatio } from "./contrast";
import { parseTokens, resolveColor, type ThemeName, type TokenMap } from "./css-tokens";
import { NOTE_COLORS } from "./note-colors";

interface Pair {
  fg: string;
  bg: string;
  min: number;
  usage: string;
}

const BACKGROUNDS = ["bg", "surface", "surface-2"];
const CODE_TOKENS = ["text", "keyword", "string", "function", "number", "type", "variable", "comment"];

// Every color/background pair used by the interface (docs/08 and docs/11), in both themes.
const PAIRS: Pair[] = [
  // Interface colors must work on every interface background (pages, panels, menus, the
  // fuse badge, which sits on a small --bg pill).
  ...BACKGROUNDS.flatMap((bg) => [
    { fg: "text", bg, min: MIN_TEXT, usage: "main text" },
    { fg: "text-muted", bg, min: MIN_TEXT, usage: "previews, dates, badge text" },
    { fg: "danger", bg, min: MIN_TEXT, usage: "errors, delete actions, badge under 1 h" },
    { fg: "brand", bg, min: MIN_LARGE, usage: "+ button, active items, focus ring" },
    { fg: "brand-2", bg, min: MIN_LARGE, usage: "secondary accent" },
    { fg: "fuse", bg, min: MIN_LARGE, usage: "fuse cord" },
    { fg: "spark", bg, min: MIN_LARGE, usage: "fuse spark" },
  ]),
  { fg: "on-brand", bg: "brand", min: MIN_TEXT, usage: "text on a brand button" },
  ...CODE_TOKENS.map((token) => ({
    fg: `code-${token}`,
    bg: "code-bg",
    min: MIN_TEXT,
    usage: `code: ${token}`,
  })),
  ...NOTE_COLORS.flatMap((color) =>
    [`note-${color}-card`, `note-${color}-card-selected`].flatMap((card) => [
      { fg: `note-${color}-on-card`, bg: card, min: MIN_TEXT, usage: "card title and icons" },
      { fg: `note-${color}-card-muted`, bg: card, min: MIN_TEXT, usage: "card preview and date" },
    ]),
  ),
  ...NOTE_COLORS.flatMap((color) => [
    {
      fg: `note-${color}-on-card`,
      bg: "surface",
      min: MIN_LARGE,
      usage: "selected card ring, against the list column",
    },
    {
      fg: `note-${color}`,
      bg: "bg",
      min: MIN_LARGE,
      usage: "editor title (26 px), bullets, checkbox fill and its --bg check mark",
    },
  ]),
];

const { light, dark, darkOnly } = parseTokens(tokensCss);
const THEMES: Record<ThemeName, TokenMap> = { light, dark };

describe.each(Object.entries(THEMES))("%s theme contrast", (_theme, tokens) => {
  it.each(PAIRS)("--$fg on --$bg ≥ $min:1 ($usage)", ({ fg, bg, min }) => {
    const ratio = contrastRatio(resolveColor(tokens, fg), resolveColor(tokens, bg));
    // WCAG thresholds are strict: 4.499 does not pass 4.5. Only the message is rounded.
    expect(ratio, `contrast of --${fg} on --${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});

describe("tokens.css structure", () => {
  it("defines the same tokens in both themes", () => {
    expect(Object.keys(darkOnly).sort()).toEqual(Object.keys(light).sort());
  });

  it("defines every note color in both themes", () => {
    for (const color of NOTE_COLORS) {
      for (const suffix of ["", "-card", "-card-selected", "-on-card", "-card-muted"]) {
        expect(light).toHaveProperty(`note-${color}${suffix}`);
        expect(darkOnly).toHaveProperty(`note-${color}${suffix}`);
      }
    }
  });

  it("maps every note color to the generic --note-* variables", () => {
    for (const color of NOTE_COLORS) {
      expect(tokensCss).toContain(`[data-note-color="${color}"]`);
    }
  });
});
