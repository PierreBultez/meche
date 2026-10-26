import { describe, expect, it } from "vitest";
import { foundText, leftOutText, notesToCheck, triageMinutes, warningText } from "./summary";
import type { ImportPlan, PlannedNote, SourceFormat } from "./types";

const planned = (format: SourceFormat, title = "", warnings: PlannedNote["warnings"] = [], importable = true): PlannedNote => ({
  note: { sourceId: title, title, content: "", kind: "rich", codeLanguage: null, pinned: false, createdAt: 0, updatedAt: 0 },
  format,
  warnings,
  importable,
});
const plan = (notes: PlannedNote[], otherItems: Record<string, number> = {}, skipped = { trashed: 0, deleted: 0, unreadable: 0 }): ImportPlan => ({
  notes,
  skipped,
  otherItems,
});

describe("summary of an import", () => {
  it("counts the notes by type", () => {
    const notes = [planned("html"), planned("html"), planned("super"), planned("checklist"), planned("text"), planned("text"), planned("code")];
    expect(foundText(plan(notes))).toBe("7 notes trouvées : 2 textes, 2 textes enrichis, 1 Super, 1 checklist, 1 note de code.");
    expect(foundText(plan([planned("code"), planned("code")]))).toBe("2 notes trouvées : 2 notes de code.");
    expect(foundText(plan([planned("other")]))).toBe("1 note trouvée : 1 autre.");
    expect(foundText(plan([]))).toBe("Aucune note à importer dans cette sauvegarde.");
  });

  it("lists the notes to check, with what happened to them", () => {
    const notes = [
      planned("html", "Recette", [{ code: "unsupported", detail: "img" }, { code: "not_exact" }]),
      planned("super", "", [{ code: "unsupported", detail: "layout" }, { code: "unsupported", detail: "youtube" }]),
      planned("text", "Énorme", [{ code: "too_large" }], false),
      planned("text", "Sans souci"),
    ];
    expect(notesToCheck(plan(notes))).toEqual([
      { title: "Recette", details: "images ignorées ; pas tout à fait à l'identique, à vérifier", importable: true },
      { title: "Sans titre", details: "mise en page simplifiée, le texte est gardé ; élément « youtube » ignoré", importable: true },
      { title: "Énorme", details: "plus de 2 Mo : pas importée", importable: false },
    ]);
    expect(warningText({ code: "unknown_type", detail: "spreadsheet" })).toBe("type « spreadsheet » inconnu, importée en note code");
  });

  it("says what is left out", () => {
    const left = leftOutText(
      plan([], { "SN|File": 34, "SN|SmartTag": 1, "SN|Component": 5, "SN|Theme": 1, "SN|UserPreferences": 1 }, { trashed: 2, deleted: 1, unreadable: 0 }),
    );
    expect(left).toBe(
      "Pas importés : 2 notes de la corbeille de Standard Notes, 1 note supprimée ou illisible, 34 fichiers joints absents de la sauvegarde, 1 étiquette (Mèche n'en a pas), 7 réglages et extensions.",
    );
    expect(leftOutText(plan([planned("text")]))).toBeNull();
  });

  it("estimates the triage at about 6 seconds a note", () => {
    expect([triageMinutes(1), triageMinutes(25), triageMinutes(100)]).toEqual([1, 3, 10]);
  });
});
