import { describe, expect, it } from "vitest";
import { longAgoText, shortRelativeDate } from "./relative-date";

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

describe("longAgoText", () => {
  const now = Date.UTC(2026, 9, 25, 12);
  const ago = (ms: number) => longAgoText(now - ms, now);
  const DAY = 86_400_000;

  it.each([
    [30_000, "à l'instant"],
    [12 * 60_000, "il y a 12 min"],
    [5 * 3_600_000, "il y a 5 h"],
    [DAY, "il y a 1 jour"],
    [3 * DAY, "il y a 3 jours"],
    [7 * DAY, "il y a 1 semaine"],
    [15 * DAY, "il y a 2 semaines"],
    [45 * DAY, "il y a 1 mois"],
    [200 * DAY, "il y a 6 mois"],
    [400 * DAY, "il y a 1 an"],
    [800 * DAY, "il y a 2 ans"],
  ])("%d ms ago is « %s »", (elapsed, text) => {
    expect(ago(elapsed)).toBe(text);
  });
});
