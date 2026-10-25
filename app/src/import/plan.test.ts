/**
 * Import of a whole Standard Notes backup (docs/07), on an anonymized backup with the structure
 * of a real one (__fixtures__/backup.ts): what each note becomes, and that every note opens in
 * the editor and is saved back unchanged (the round trip of docs/05).
 */
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createRichExtensions } from "../editor/extensions";
import { serializeMarkdown } from "../editor/serialize";
import { BACKUP, IDS, backupFromRust } from "./__fixtures__/backup";
import { MAX_CONTENT_BYTES, notesToImport, planImport } from "./plan";
import type { PlannedNote } from "./types";

const NOW = 1_800_000_000_000;
const plan = await planImport(backupFromRust(BACKUP.items as Array<Record<string, unknown>>), { now: NOW });
const planned = (id: string): PlannedNote => {
  const found = plan.notes.find((entry) => entry.note.sourceId === id.toLowerCase());
  if (!found) throw new Error(`no note ${id}`);
  return found;
};

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

/** What the editor saves after opening `markdown` and changing nothing. */
function reopened(markdown: string): string {
  const editor = new Editor({ extensions: createRichExtensions(), content: markdown, contentType: "markdown" });
  editors.push(editor);
  return serializeMarkdown(editor);
}

describe("a whole backup", () => {
  it("keeps the notes, leaves out the trash and the deleted ones", () => {
    expect(plan.notes.map((entry) => entry.note.sourceId)).toEqual([
      IDS.html,
      IDS.super,
      IDS.advanced,
      IDS.simple,
      IDS.plain,
      IDS.php,
      IDS.sql,
      IDS.markdown,
      IDS.sheet,
      IDS.conflict.toLowerCase(),
      IDS.undated,
    ]);
    expect(plan.skipped).toEqual({ trashed: 1, deleted: 1, unreadable: 0 });
    expect(plan.otherItems).toEqual({ "SN|UserPreferences": 1, "SN|Component": 1, "SN|File": 1 });
  });

  it("tells where each note comes from", () => {
    expect(plan.notes.map((entry) => entry.format)).toEqual([
      "html",
      "super",
      "checklist",
      "checklist",
      "text",
      "code",
      "code",
      "markdown",
      "other",
      "text",
      "text",
    ]);
  });

  it("keeps the dates of Standard Notes, the user's modification first", () => {
    // `client_updated_at` (the date Standard Notes shows), not the server's `updated_at`.
    expect(planned(IDS.html).note).toMatchObject({
      createdAt: Date.parse("2024-03-01T10:00:00.250Z"),
      updatedAt: Date.parse("2026-04-01T08:00:00.000Z"),
    });
    // Without it, `updated_at`.
    expect(planned(IDS.php).note.updatedAt).toBe(Date.parse("2025-06-12T08:30:04.512Z"));
    // Without any date: now.
    expect(planned(IDS.undated).note).toMatchObject({ createdAt: NOW, updatedAt: NOW });
  });

  it("reads « pinned » where Standard Notes stores it (appData)", () => {
    expect(plan.notes.filter((entry) => entry.note.pinned).map((entry) => entry.note.sourceId)).toEqual([IDS.html]);
  });

  it("writes the ids in lowercase and titles on one line", () => {
    expect(planned(IDS.conflict).note).toMatchObject({
      sourceId: IDS.conflict.toLowerCase(),
      title: "Titre sur deux lignes",
    });
  });

  it("reports only what could not be kept", () => {
    const warnings = Object.fromEntries(plan.notes.map((entry) => [entry.note.sourceId, entry.warnings]));
    expect(warnings).toEqual({
      [IDS.html]: [{ code: "unsupported", detail: "img" }],
      [IDS.super]: [{ code: "unsupported", detail: "snfile" }],
      [IDS.advanced]: [],
      [IDS.simple]: [],
      [IDS.plain]: [],
      [IDS.php]: [],
      [IDS.sql]: [],
      [IDS.markdown]: [{ code: "raw_html" }],
      [IDS.sheet]: [{ code: "unknown_type", detail: "spreadsheet" }],
      [IDS.conflict.toLowerCase()]: [],
      [IDS.undated]: [],
    });
  });

  it("opens every rich note in the editor and saves it back unchanged", () => {
    const rich = plan.notes.filter((entry) => entry.note.kind === "rich");
    expect(rich).toHaveLength(8);
    for (const entry of rich) {
      expect(reopened(entry.note.content), entry.note.sourceId).toBe(entry.note.content);
    }
  });
});

describe("what each note becomes", () => {
  it("an HTML note pasted from the web", () => {
    expect(planned(IDS.html).note.content).toBe(
      [
        "Recette des crêpes : mélanger la farine et les œufs.",
        "",
        "## Ingrédients",
        "",
        "- [ ] **250 g** de farine",
        "- [x] 4 œufs *frais*",
        "",
        "### Astuce",
        "",
        "Pas en gras mais **celui-ci oui**, et `beurre` fondu.",
        "",
        // The label of the pasted code block's header: text of the page, kept.
        "bash",
        "",
        "```bash",
        "ls -la",
        "cd /tmp",
        "```",
        "",
        "```",
        "ligne 1",
        "ligne 2",
        "```",
        "",
        "|          |          |",
        "| -------- | -------- |",
        "| **Jour** | **Menu** |",
        "| Lundi    | Soupe    |",
        "",
        "---",
        "",
        "Voir [la recette](https://example.com/crepes) et ce lien.",
        "",
        "Fin.",
        "",
        "- [x] Acheter du lait",
        "- [ ] Sortir le chien",
        "",
        "\\-- ------ ----",
      ].join("\n"),
    );
  });

  it("a Super note", () => {
    expect(planned(IDS.super).note.content).toBe(
      [
        "# Voyage en Bretagne",
        "",
        "Partir **tôt** le *samedi* avec `npm ci` et ***tout*** : 2 \\* 3 sacs.",
        "",
        "## Valise",
        "",
        "- Vêtements",
        "  - Pulls",
        "  - Imperméable",
        "- Trousse #toilette",
        "- [https://example.com/meteo](https://example.com/meteo)",
        "",
        "1. Réserver le train",
        "2. Prévenir les voisins",
        "",
        "- [x] Billets",
        "- [ ] Chargeur",
        "- [ ] Carte",
        "",
        "| Jour   | Ville  |",
        "| ------ | ------ |",
        "| Samedi | Rennes |",
        "",
        "---",
        "",
        "> Qui voit Ouessant voit son sang.",
        "",
        "```javascript",
        "const jours = 3;",
        "partir(jours);",
        "```",
        "",
        "Fin du voyage",
      ].join("\n"),
    );
  });

  it("an Advanced Checklist note: tasks to do, then done, the draft too", () => {
    expect(planned(IDS.advanced).note.content).toBe(
      [
        "## Jardin",
        "",
        "- [ ] Planter les tomates  ",
        "  pas avant mai",
        "- [ ] Arroser \\*tous\\* les soirs",
        "- [x] Tondre la pelouse",
        "",
        "## Garage",
        "",
        "- [ ] Ranger les outils",
        "",
        "## Grenier",
      ].join("\n"),
    );
  });

  it("a Simple Task Editor note", () => {
    expect(planned(IDS.simple).note.content).toBe("- [ ] Pain\n- [x] Lait\n- [ ] Beurre \\*doux\\*");
  });

  it("a plain text note: every character stays as typed", () => {
    expect(planned(IDS.plain).note.content).toBe(
      [
        "Caractères spéciaux pour le test :  ",
        "1- a\\*b\\_c&lt;d&gt;#e|f\\[g\\]\\\\h  ",
        "2- x\\_\\_y\\_\\_z \\~\\~w\\~\\~ \\`v\\`  ",
        "&#32; indenté de deux espaces  ",
        "&#9;avec une tabulation",
        "",
        "\\# pas un titre  ",
        "\\- pas une puce  ",
        "&gt; pas une citation  ",
        "&lt;b&gt;pas du HTML&lt;/b&gt; &amp; co  ",
        "\\---",
      ].join("\n"),
    );
  });

  it("code notes keep their code, with the language of their editor or a guess", () => {
    expect(planned(IDS.php).note).toMatchObject({ kind: "code", codeLanguage: "php", content: "<?php\necho 'Bonjour';\n" });
    expect(planned(IDS.sql).note).toMatchObject({ kind: "code", codeLanguage: "sql", title: "" });
  });

  it("a Markdown note is written the editor's way; its HTML is reported", () => {
    expect(planned(IDS.markdown).note.content).toBe(
      ["# Titre", "", "- un", "- deux", "", "**gras** et du HTML", "", "```vue", "<b>gardé dans le code</b>", "```"].join("\n"),
    );
  });

  it("an unknown type keeps its text in a plain text code note", () => {
    expect(planned(IDS.sheet).note).toMatchObject({
      kind: "code",
      codeLanguage: "plaintext",
      content: '{"sheets":[{"rows":[]}]}',
    });
  });
});

describe("notes that cannot be imported as they are", () => {
  const item = (content: Record<string, unknown>) => ({
    uuid: "e0000000-0000-4000-8000-000000000001",
    content_type: "Note",
    created_at: "2024-01-01T00:00:00.000Z",
    content,
  });
  const only = async (content: Record<string, unknown>) =>
    (await planImport(backupFromRust([item(content)]), { now: NOW })).notes[0];

  it("refuses a note larger than 2 MB once converted", async () => {
    const big = await only({ title: "Gros", text: "a".repeat(MAX_CONTENT_BYTES + 1), noteType: "plain-text" });
    expect(big.importable).toBe(false);
    expect(big.warnings).toEqual([{ code: "too_large" }]);
    expect(notesToImport({ notes: [big], skipped: { trashed: 0, deleted: 0, unreadable: 0 }, otherItems: {} })).toEqual([]);
  });

  it("cuts a title longer than 500 characters", async () => {
    const long = await only({ title: "é".repeat(501), text: "x", noteType: "plain-text" });
    expect(Array.from(long.note.title)).toHaveLength(500);
    expect(long.warnings).toEqual([{ code: "title_cut" }]);
  });

  it("imports a Super note that is not JSON as plain text", async () => {
    const broken = await only({ title: "Super", text: "pas du *JSON*", noteType: "super" });
    expect(broken.note.content).toBe("pas du \\*JSON\\*");
    expect(broken.warnings).toEqual([{ code: "unreadable" }]);
  });

  it("an empty Super note stays empty", async () => {
    expect((await only({ title: "Vide", text: "", noteType: "super" })).note.content).toBe("");
  });

  it("guesses the editor of old notes without noteType", async () => {
    expect((await only({ text: "<p>a</p>", editorIdentifier: "org.standardnotes.plus-editor" })).format).toBe("html");
    expect((await only({ text: "- [ ] a", editorIdentifier: "org.standardnotes.simple-task-editor" })).format).toBe("checklist");
    expect((await only({ text: "a" })).format).toBe("text");
  });

  it("skips what is not a note it can read", async () => {
    const result = await planImport(
      {
        version: "004",
        notes: [
          null,
          3,
          { content_type: "Note" },
          { uuid: "x", content: "004:chiffré" },
          { uuid: "y", content: {}, errorDecrypting: true },
          // Rust refuses an id longer than 100 characters, and the whole import with it.
          { uuid: "z".repeat(101), content: { text: "a" } },
        ],
        otherItems: {},
      },
      { now: NOW },
    );
    expect(result.notes).toEqual([]);
    expect(result.skipped.unreadable).toBe(6);
  });

  it("leaves out a note the converters cannot read, and imports the others", async () => {
    const lexical = JSON.stringify({ root: { type: "root", children: [{ type: "paragraph", children: [null, { type: "text", text: "a" }] }] } });
    const result = await planImport(
      backupFromRust([
        // A getter that throws: what no converter expects.
        { ...item({ text: "b" }), uuid: "e0000000-0000-4000-8000-000000000003", content: { get text() { throw new Error("x"); } } },
        { ...item({ text: lexical, noteType: "super" }), uuid: "e0000000-0000-4000-8000-000000000004" },
      ]),
      { now: NOW },
    );
    expect(result.skipped.unreadable).toBe(1);
    expect(result.notes.map((note) => note.note.content)).toEqual(["a"]);
  });

  it("takes dates out of the range of dates, or at 1970, as missing", async () => {
    const note = (await planImport(
      backupFromRust([
        { ...item({ text: "a" }), created_at: "1970-01-01T00:00:00.000Z", created_at_timestamp: 1e300, updated_at: undefined, updated_at_timestamp: -5 },
      ]),
      { now: NOW },
    )).notes[0].note;
    expect(note.createdAt).toBe(NOW);
    expect(note.updatedAt).toBe(NOW);
  });

  it("reports what a Markdown note loses: HTML, images, footnotes", async () => {
    const note = await only({ text: "Voir ![schéma](https://example.com/s.png)[^1] <b>gras</b>\n\n[^1]: Wikipédia\n\n```\n<i>code</i> ![pas](une-image)\n```", noteType: "markdown" });
    expect(note.warnings).toEqual([
      { code: "unsupported", detail: "image" },
      { code: "raw_html" },
      { code: "unsupported", detail: "footnote" },
    ]);
  });
});

describe("crafted notes do not freeze the import (security review, phase 4)", () => {
  const item = (content: Record<string, unknown>) => ({
    uuid: "e0000000-0000-4000-8000-000000000002",
    content_type: "Note",
    created_at: "2024-01-01T00:00:00.000Z",
    content,
  });
  // A regular expression that backtracks takes minutes on such texts; a linear one, milliseconds.
  const spaces = "a" + " ".repeat(200_000) + "b";
  it.each([
    ["plain text full of spaces", { text: spaces, noteType: "plain-text" }],
    ["a title full of spaces", { title: spaces, text: "x", noteType: "plain-text" }],
    ["HTML full of spaces", { text: `<p>${spaces}</p><pre>${spaces}</pre>`, noteType: "rich-text" }],
    ["Markdown full of tag starts", { text: "<a".repeat(100_000), noteType: "markdown" }],
    ["code full of new lines", { text: "\n".repeat(200_000) + "x", noteType: "code" }],
    ["code full of spaces", { text: spaces, noteType: "code" }],
    ["a checklist full of spaces", { text: `- [ ] ${spaces}`, noteType: "task" }],
    ["a table-like line full of spaces", { text: " ".repeat(100_000) + "|x", noteType: "plain-text" }],
  ])("%s", async (_case, content) => {
    const started = performance.now();
    await planImport(backupFromRust([item(content)]), { now: NOW });
    expect(performance.now() - started).toBeLessThan(3_000);
  }, 60_000);

  it("ignores names like « __proto__ » in the data of an editor", async () => {
    const note = (await planImport(
      backupFromRust([item({ text: "x", noteType: "code", appData: { "org.standardnotes.sn.components": { e: { mode: "__proto__" } } } })]),
      { now: NOW },
    )).notes[0];
    expect(note.note.codeLanguage).toBe("plaintext");
    const odd = (await planImport(backupFromRust([item({ text: "x", editorIdentifier: "constructor" })]), { now: NOW })).notes[0];
    expect(odd.format).toBe("text");
  });
});

describe("a big backup does not freeze the page", () => {
  const items = Array.from({ length: 300 }, (_, index) => ({
    uuid: `e0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    content_type: "Note",
    content: { title: `Note ${index}`, text: `<p>Texte <b>${index}</b></p>`.repeat(20), noteType: "rich-text" },
  }));

  it("tells its progress, and pauses between notes", async () => {
    const progress: number[] = [];
    let pauses = 0;
    const timer = setInterval(() => pauses++, 0);
    try {
      await planImport(backupFromRust(items), { now: NOW, onProgress: (done, total) => progress.push(done / total) });
    } finally {
      clearInterval(timer);
    }
    expect(progress).toHaveLength(300);
    expect(progress[299]).toBe(1);
    expect(pauses).toBeGreaterThan(0);
  });

  it("stops when the user leaves", async () => {
    const leaving = new AbortController();
    let converted = 0;
    const planning = planImport(backupFromRust(items), {
      now: NOW,
      signal: leaving.signal,
      onProgress: (done) => {
        converted = done;
        if (done === 1) leaving.abort();
      },
    });
    await expect(planning).rejects.toThrow();
    expect(converted).toBeLessThan(300);
  });
});
