import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createRichExtensions } from "./extensions";
import { filterSlashCommands, simplify, slashAllowed } from "./slash-commands";

const labels = (query: string) => filterSlashCommands(query).map((command) => command.label);

describe("slash menu", () => {
  it("offers every command of docs/05 when nothing is typed", () => {
    expect(labels("")).toEqual([
      "Titre 1",
      "Titre 2",
      "Titre 3",
      "Liste",
      "Liste numérotée",
      "Checklist",
      "Bloc de code",
      "Citation",
      "Tableau",
      "Séparateur",
    ]);
  });

  it("filters by label, by any word of the label and by keyword, ignoring accents", () => {
    expect(labels("tit")).toEqual(["Titre 1", "Titre 2", "Titre 3"]);
    expect(labels("numerot")).toEqual(["Liste numérotée"]);
    expect(labels("code")).toEqual(["Bloc de code"]);
    expect(labels("todo")).toEqual(["Checklist"]);
    expect(labels("SEP")).toEqual(["Séparateur"]);
    expect(labels("zzz")).toEqual([]);
  });

  it("simplifies accents and case", () => {
    expect(simplify("Séparateur Numérotée")).toBe("separateur numerotee");
  });
});

describe("slashAllowed", () => {
  const editors: Editor[] = [];
  afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

  function allowedAt(content: JSONContent[], from: number): boolean {
    const editor = new Editor({ extensions: createRichExtensions(), content: { type: "doc", content } });
    editors.push(editor);
    return slashAllowed({ state: editor.state, range: { from, to: from + 2 } });
  }
  const bold = (value: string): JSONContent => ({ type: "text", text: value, marks: [{ type: "bold" }] });
  const text = (value: string): JSONContent => ({ type: "text", text: value });

  it("opens at the start of a paragraph or after a line break", () => {
    expect(allowedAt([{ type: "paragraph", content: [text("/b")] }], 1)).toBe(true);
    expect(allowedAt([{ type: "paragraph", content: [text("x"), { type: "hardBreak" }, text("/b")] }], 3)).toBe(true);
  });

  it("does not open right after a bold word or in a code block", () => {
    expect(allowedAt([{ type: "paragraph", content: [bold("A"), text("/b")] }], 2)).toBe(false);
    expect(allowedAt([{ type: "codeBlock", content: [text("/todo")] }], 1)).toBe(false);
  });
});
