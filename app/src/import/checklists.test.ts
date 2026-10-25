import { afterAll, describe, expect, it } from "vitest";
import { advancedChecklistToDoc, isAdvancedChecklist, simpleTasksToDoc } from "./checklists";
import { cleanDoc } from "./doc";
import { MarkdownWriter } from "./markdown-writer";

const writer = new MarkdownWriter();
afterAll(() => writer.destroy());

const markdown = (doc: Parameters<typeof cleanDoc>[0], sourceText: string) =>
  writer.write(cleanDoc(doc, { collapseSpaces: false }), sourceText);

describe("Advanced Checklist", () => {
  const checklist = (groups: object[]) => JSON.stringify({ schemaVersion: "1.0.0", groups, defaultSections: [] });
  const task = (description: string, completed = false) => ({ id: description, description, completed, createdAt: "2025-01-01T00:00:00.000Z" });

  it("is recognized by its groups", () => {
    expect(isAdvancedChecklist(checklist([]))).toBe(true);
    expect(isAdvancedChecklist("- [ ] a")).toBe(false);
    expect(isAdvancedChecklist('{"tasks": []}')).toBe(false);
    expect(isAdvancedChecklist("null")).toBe(false);
  });

  it("writes each group as a heading, its tasks to do, then done", () => {
    const source = checklist([
      { name: "Maison", tasks: [task("Fait", true), task("À faire"), task("Aussi à faire")] },
      { name: "Bureau", tasks: [task("Imprimer")] },
    ]);
    const { doc, sourceText } = advancedChecklistToDoc(source);
    expect(markdown(doc, sourceText)).toEqual({
      markdown: "## Maison\n\n- [ ] À faire\n- [ ] Aussi à faire\n- [x] Fait\n\n## Bureau\n\n- [ ] Imprimer",
      exact: true,
    });
  });

  it("keeps a task typed but not added, a group without task, and drops empty tasks", () => {
    const source = checklist([
      { name: "Liste", draft: "Pas encore ajoutée", tasks: [task("   ")] },
      { name: "Vide", tasks: [] },
      { name: "", tasks: [task("Sans groupe")] },
    ]);
    const { doc, sourceText } = advancedChecklistToDoc(source);
    expect(markdown(doc, sourceText).markdown).toBe("## Liste\n\n- [ ] Pas encore ajoutée\n\n## Vide\n\n- [ ] Sans groupe");
  });

  it("keeps the line breaks of a task, and its text as typed", () => {
    const { doc, sourceText } = advancedChecklistToDoc(checklist([{ name: "G", tasks: [task("Ligne 1\nligne 2 avec *étoile*")] }]));
    expect(markdown(doc, sourceText)).toEqual({
      markdown: "## G\n\n- [ ] Ligne 1  \n  ligne 2 avec \\*étoile\\*",
      exact: true,
    });
  });
});

describe("Simple Task Editor", () => {
  it("reads one task per line, checked or not", () => {
    const { doc, sourceText } = simpleTasksToDoc("- [ ] Pain\n- [x] Lait\n- [X] Œufs\n* [ ] Beurre\n[ ] Sans tiret");
    expect(markdown(doc, sourceText)).toEqual({
      markdown: "- [ ] Pain\n- [x] Lait\n- [x] Œufs\n- [ ] Beurre\n- [ ] Sans tiret",
      exact: true,
    });
  });

  it("keeps other lines as paragraphs, between the checklists", () => {
    const { doc, sourceText } = simpleTasksToDoc("Courses\n- [ ] Pain\n\nPour samedi\nsans faute\n- [x] Gâteau\n- [ ] ");
    expect(markdown(doc, sourceText)).toEqual({
      markdown: "Courses\n\n- [ ] Pain\n\nPour samedi  \nsans faute\n\n- [x] Gâteau",
      exact: true,
    });
  });

  it("keeps boxes and dashes written inside a task or a line (no false report)", () => {
    const { doc, sourceText } = simpleTasksToDoc("- [ ] fix [x] coords\n- une ligne avec un tiret");
    expect(markdown(doc, sourceText)).toEqual({
      markdown: "- [ ] fix \\[x\\] coords\n\n\\- une ligne avec un tiret",
      exact: true,
    });
  });

  it("keeps a task typed but not added yet", () => {
    const { doc, sourceText } = simpleTasksToDoc("- [x] Lait", "acheter du pain");
    expect(markdown(doc, sourceText).markdown).toBe("- [x] Lait\n- [ ] acheter du pain");
  });
});
