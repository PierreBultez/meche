import { describe, expect, it } from "vitest";
import { shortRelativeDate } from "./relative-date";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const ago = (ms: number) => shortRelativeDate(NOW - ms, NOW);

describe("shortRelativeDate", () => {
  it.each([
    [0, "à l'instant"],
    [59_000, "à l'instant"],
    [12 * 60_000, "12 min"],
    [5 * 3_600_000, "5 h"],
    [2 * 86_400_000, "2 j"],
    [15 * 86_400_000, "2 sem"],
    [90 * 86_400_000, "3 mois"],
    [400 * 86_400_000, "1 an"],
    [800 * 86_400_000, "2 ans"],
  ])("%d ms ago → %s", (elapsed, expected) => {
    expect(ago(elapsed)).toBe(expected);
  });

  it("treats a date in the future as now", () => {
    expect(shortRelativeDate(NOW + 60_000, NOW)).toBe("à l'instant");
  });
});
