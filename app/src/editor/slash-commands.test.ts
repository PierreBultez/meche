import { describe, expect, it } from "vitest";
import { filterSlashCommands, simplify } from "./slash-commands";

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
