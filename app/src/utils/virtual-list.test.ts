import { describe, expect, it } from "vitest";
import { scrollToShow, visibleRange } from "./virtual-list";

describe("visibleRange", () => {
  it("draws the rows in view plus a margin", () => {
    // 10 rows of 50 px fit in 500 px, +1 for a partly visible row, +5 below.
    expect(visibleRange(0, 500, 50, 1000)).toEqual({ start: 0, end: 16 });
    expect(visibleRange(5000, 500, 50, 1000)).toEqual({ start: 95, end: 116 });
  });

  it("stays within the list", () => {
    expect(visibleRange(49_500, 500, 50, 1000)).toEqual({ start: 984, end: 1000 });
    expect(visibleRange(0, 500, 50, 3)).toEqual({ start: 0, end: 3 });
    expect(visibleRange(0, 500, 50, 0)).toEqual({ start: 0, end: 0 });
  });

  it("still draws the end of the list when the scroll position is outdated", () => {
    // The list shrank from 1000 to 20 rows before the browser moved the scroll bar.
    const { start, end } = visibleRange(40_000, 500, 50, 20);
    expect(end).toBe(20);
    expect(start).toBeLessThanOrEqual(9);
  });
});

describe("scrollToShow", () => {
  it("moves only when the row is out of view", () => {
    expect(scrollToShow(3, 0, 500, 50)).toBeNull();
    expect(scrollToShow(2, 200, 500, 50)).toBe(100);
    expect(scrollToShow(12, 0, 500, 50)).toBe(150);
  });
});
