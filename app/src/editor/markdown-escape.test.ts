import { describe, expect, it } from "vitest";
import { escapeBlockStarts } from "./markdown-escape";

describe("escapeBlockStarts", () => {
  it.each([
    ["1. pas une liste", "1\\. pas une liste"],
    ["12) non plus", "12\\) non plus"],
    ["- pas une puce", "\\- pas une puce"],
    ["+ pas une puce", "\\+ pas une puce"],
    ["# pas un titre", "\\# pas un titre"],
    ["> pas une citation", "\\> pas une citation"],
    ["```js", "\\```js"],
    ["---", "\\---"],
    ["===", "\\==="],
  ])("escapes %j", (input, expected) => {
    expect(escapeBlockStarts(input)).toBe(expected);
  });

  it.each([
    "Une phrase normale.",
    "Prix : 5 - 3 = 2",
    "#hashtag",
    "2026 était une année",
    "\\- déjà échappé",
    "a -- b",
  ])("leaves %j alone", (input) => {
    expect(escapeBlockStarts(input)).toBe(input);
  });

  it("escapes every line of a paragraph with hard breaks", () => {
    expect(escapeBlockStarts("Courses :\\\n- lait")).toBe("Courses :\\\n\\- lait");
  });
});
