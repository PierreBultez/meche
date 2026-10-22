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

// Every text/background pair whose usage is defined in docs/11 and docs/08.
const PAIRS: Pair[] = [
  ...BACKGROUNDS.flatMap((bg) => [
    { fg: "text", bg, min: MIN_TEXT, usage: "main text" },
    { fg: "text-muted", bg, min: MIN_TEXT, usage: "previews and dates" },
    { fg: "brand", bg, min: MIN_LARGE, usage: "+ button, active items, focus ring" },
  ]),
  { fg: "on-brand", bg: "brand", min: MIN_TEXT, usage: "text on a brand button" },
  { fg: "danger", bg: "bg", min: MIN_TEXT, usage: "errors" },
  { fg: "fuse", bg: "bg", min: MIN_LARGE, usage: "long fuse cord under the note header" },
  { fg: "spark", bg: "bg", min: MIN_LARGE, usage: "spark of the long fuse" },
  ...CODE_TOKENS.map((token) => ({
    fg: `code-${token}`,
    bg: "code-bg",
    min: MIN_TEXT,
    usage: `code: ${token}`,
  })),
  ...NOTE_COLORS.flatMap((color) => [
    { fg: `note-${color}-on-card`, bg: `note-${color}-card`, min: MIN_TEXT, usage: "card title" },
    {
      fg: `note-${color}-on-card`,
      bg: `note-${color}-card-selected`,
      min: MIN_TEXT,
      usage: "selected card title",
    },
    { fg: `note-${color}`, bg: "bg", min: MIN_LARGE, usage: "editor title (26 px), checkboxes" },
  ]),
];

const { light, dark, darkOnly } = parseTokens(tokensCss);
const THEMES: Record<ThemeName, TokenMap> = { light, dark };

describe.each(Object.entries(THEMES))("%s theme contrast", (_theme, tokens) => {
  it.each(PAIRS)("--$fg on --$bg ≥ $min:1 ($usage)", ({ fg, bg, min }) => {
    const ratio = contrastRatio(resolveColor(tokens, fg), resolveColor(tokens, bg));
    // Rounded in the message so a failure reads like "3.41 is not ≥ 4.5".
    expect(Number(ratio.toFixed(2)), `contrast of --${fg} on --${bg}`).toBeGreaterThanOrEqual(min);
  });
});

describe("tokens.css structure", () => {
  it("defines the same tokens in both themes", () => {
    expect(Object.keys(darkOnly).sort()).toEqual(Object.keys(light).sort());
  });

  it("defines every note color in both themes", () => {
    for (const color of NOTE_COLORS) {
      for (const suffix of ["", "-card", "-card-selected", "-on-card"]) {
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
