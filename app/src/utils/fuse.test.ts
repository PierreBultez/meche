import { describe, expect, it } from "vitest";
import { FUSE_DELAYS, fuseDelayLabel, fuseExplodesIn, fuseIsShort, fuseTimeLeft } from "./fuse";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("fuse texts (docs/06, docs/11)", () => {
  it.each([
    [7 * DAY, "7 j"],
    [2 * DAY + 23 * HOUR, "2 j"],
    [DAY, "1 j"],
    [DAY - 1, "23 h"],
    [5 * HOUR + 59 * MINUTE, "5 h"],
    [HOUR, "1 h"],
    [HOUR - 1, "59 min"],
    [12 * MINUTE, "12 min"],
    [MINUTE, "1 min"],
    [MINUTE - 1, "< 1 min"],
    [0, "< 1 min"],
    [-5 * MINUTE, "< 1 min"],
  ])("a card shows %i ms left as %s", (left, text) => {
    expect(fuseTimeLeft(1_000_000 + left, 1_000_000)).toBe(text);
  });

  it.each([
    [2 * DAY + 4 * HOUR + 30 * MINUTE, "Explose dans 2 j 4 h"],
    [3 * DAY + 10 * MINUTE, "Explose dans 3 j"],
    [5 * HOUR + 12 * MINUTE, "Explose dans 5 h 12 min"],
    [HOUR, "Explose dans 1 h"],
    [42 * MINUTE + 59_000, "Explose dans 42 min"],
    [30_000, "Explose dans moins d'une minute"],
    [-1, "Explose dans moins d'une minute"],
  ])("the open note shows %i ms left as %s", (left, text) => {
    expect(fuseExplodesIn(left, 0)).toBe(text);
  });

  it("warns under one hour", () => {
    expect(fuseIsShort(HOUR, 0)).toBe(false);
    expect(fuseIsShort(HOUR - 1, 0)).toBe(true);
  });

  it("offers the delays of the Rust setting", () => {
    // Same list as FUSE_DELAYS_HOURS in src-tauri/src/db/settings.rs.
    expect(FUSE_DELAYS.map((delay) => delay.hours)).toEqual([1, 24, 72, 168, 720]);
    expect(fuseDelayLabel(168)).toBe("7 jours");
    expect(fuseDelayLabel(1)).toBe("1 heure");
  });
});
