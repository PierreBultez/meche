import { describe, expect, it } from "vitest";
import { contrastRatio, mixSrgb, parseHex, toHex } from "./contrast";

describe("contrast helpers", () => {
  it("gives 21:1 for black on white and 1:1 for identical colors", () => {
    expect(contrastRatio(parseHex("#000000"), parseHex("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex("#7b2ff7"), parseHex("#7b2ff7"))).toBe(1);
  });

  it("is symmetric", () => {
    const a = parseHex("#1c1433");
    const b = parseHex("#f7f5fc");
    expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
  });

  it("matches a known WCAG value", () => {
    // #767676 on white is the classic "just passes 4.5:1" gray.
    expect(contrastRatio(parseHex("#767676"), parseHex("#ffffff"))).toBeCloseTo(4.54, 2);
  });

  it("parses #rrggbbaa and ignores alpha", () => {
    expect(parseHex("#7b2ff733")).toEqual({ r: 0x7b, g: 0x2f, b: 0xf7 });
  });

  it("rejects anything that is not a hex color", () => {
    expect(() => parseHex("red")).toThrow();
    expect(() => parseHex("#fff")).toThrow();
  });

  it("mixes like CSS color-mix(in srgb)", () => {
    const mixed = mixSrgb(parseHex("#ffffff"), parseHex("#000000"), 0.5);
    expect(toHex(mixed)).toBe("#808080");
  });
});
