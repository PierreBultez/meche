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
    ["--", "\\--"],
    ["=", "\\="],
    ["-", "\\-"],
    ["+", "\\+"],
    ["    indenté", "&#32;   indenté"],
    ["\tindenté", "&#9;indenté"],
    ["  - indentée", "&#32; \\- indentée"],
    ["M. Dupont", "M\\. Dupont"],
    ["Cf. le document", "Cf\\. le document"],
    ["a) option", "a\\) option"],
    ["IV. Chapitre", "IV\\. Chapitre"],
    ["0612345678. Appeler", "0612345678\\. Appeler"],
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
    "Mr.Dupont",
    "Abc. trois lettres",
  ])("leaves %j alone", (input) => {
    expect(escapeBlockStarts(input)).toBe(input);
  });

  it("writes a second line break in a row as a backslash", () => {
    expect(escapeBlockStarts("a  \n  \nb")).toBe("a  \n\\\nb");
  });

  it("leaves the spaces of table cells alone (a cell is trimmed)", () => {
    expect(escapeBlockStarts("  x", true)).toBe("  x");
    expect(escapeBlockStarts("- x", true)).toBe("\\- x");
  });

  it("escapes every line of a paragraph with hard breaks", () => {
    expect(escapeBlockStarts("Courses :\\\n- lait")).toBe("Courses :\\\n\\- lait");
  });
});
