// An anonymized Standard Notes backup: the structure of a real one (docs/07, section 2), with
// invented content. Every note type and every form met in the real backup is here, plus the
// types it did not have (code, Markdown, spreadsheet). Never put real notes in this file.

/** Lexical text node; `format` is the bit mask of Lexical (1 bold, 2 italic, 16 code…). */
const t = (text: string, format = 0) => ({ type: "text", text, format, detail: 0, mode: "normal", style: "", version: 1 });
const p = (...children: object[]) => ({ type: "paragraph", children, direction: "ltr", format: "", indent: 0, textFormat: 0, version: 1 });
const li = (value: number, children: object[], extra: object = {}) => ({ type: "listitem", value, children, direction: "ltr", format: "", indent: 0, version: 1, ...extra });
const list = (listType: string, children: object[]) => ({ type: "list", listType, start: 1, tag: listType === "number" ? "ol" : "ul", children, direction: "ltr", format: "", indent: 0, version: 1 });
const cell = (...children: object[]) => ({ type: "tablecell", headerState: 0, colSpan: 1, rowSpan: 1, backgroundColor: null, children, direction: null, format: "", indent: 0, version: 1 });

export const LEXICAL_STATE = {
  root: {
    type: "root",
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
    children: [
      { type: "heading", tag: "h1", children: [t("Voyage"), { type: "linebreak", version: 1 }, t("en Bretagne")], direction: "ltr", format: "", indent: 0, version: 1 },
      p(t("Partir "), t("tôt", 1), t(" le "), t("samedi", 2), t(" avec "), t("npm ci", 16), t(" et "), t("tout", 3), t(" : 2 * 3 sacs.")),
      p(),
      { type: "heading", tag: "h2", children: [t("Valise")], direction: null, format: "", indent: 0, version: 1 },
      list("bullet", [
        li(1, [t("Vêtements")]),
        // Lexical keeps a nested list in an item of its own, after its parent.
        li(2, [list("bullet", [li(1, [t("Pulls")]), li(2, [t("Imperméable")])])]),
        li(2, [t("Trousse "), { type: "hashtag", text: "#toilette", format: 0, detail: 0, mode: "normal", style: "", version: 1 }]),
        li(3, [{ type: "autolink", url: "https://example.com/meteo", rel: null, target: null, title: null, children: [t("https://example.com/meteo")], direction: "ltr", format: "", indent: 0, version: 1 }]),
      ]),
      list("number", [li(1, [t("Réserver le train")]), li(2, [t("Prévenir les voisins")])]),
      list("check", [
        li(1, [t("Billets")], { checked: true }),
        li(2, [t("Chargeur")], { checked: false }),
        li(3, [t("Carte")]),
      ]),
      {
        type: "table",
        children: [
          { type: "tablerow", children: [cell(p(t("Jour"))), cell(p(t("Ville")))], direction: null, format: "", indent: 0, version: 1 },
          { type: "tablerow", children: [cell(p(t("Samedi"))), cell(p(t("Rennes")))], direction: null, format: "", indent: 0, version: 1 },
        ],
        direction: null,
        format: "",
        indent: 0,
        version: 1,
      },
      { type: "horizontalrule", version: 1 },
      { type: "quote", children: [t("Qui voit Ouessant voit son sang.")], direction: "ltr", format: "", indent: 0, version: 1 },
      {
        type: "code",
        language: "javascript",
        children: [
          { type: "code-highlight", text: "const", highlightType: "keyword", format: 0, detail: 0, mode: "normal", style: "", version: 1 },
          { type: "code-highlight", text: " jours = 3;", format: 0, detail: 0, mode: "normal", style: "", version: 1 },
          { type: "linebreak", version: 1 },
          { type: "code-highlight", text: "partir(jours);", format: 0, detail: 0, mode: "normal", style: "", version: 1 },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
      },
      // An attached file: nothing of it is in the backup.
      { type: "snfile", fileUuid: "00000000-0000-4000-8000-000000000001", version: 1 },
      p(t("Fin "), { type: "link", url: "javascript:alert(1)", rel: null, target: null, title: null, children: [t("du voyage")], direction: "ltr", format: "", indent: 0, version: 1 }),
    ],
  },
};

export const RICH_TEXT_HTML = [
  '<p dir="auto"><span style="font-size: 16px; color: rgb(10, 10, 10); font-family: Arial;">Recette des crêpes&nbsp;: mélanger&nbsp;&nbsp;la farine et les œufs.</span></p>',
  '<h2 class="text-text-100" dir="auto">Ingrédients</h2>',
  '<ul dir="auto"><li dir="auto"><input type="checkbox" disabled="" readonly=""> <strong>250 g</strong> de farine</li>',
  '<li dir="auto"><input type="checkbox" disabled="" readonly="" checked=""> 4 œufs <em>frais</em></li></ul>',
  '<h4 dir="auto">Astuce</h4>',
  '<p dir="auto"><b style="font-weight: 400;">Pas en gras</b> mais <b>celui-ci oui</b>, et <code>beurre</code> fondu.</p>',
  '<div class="relative" dir="auto"><div class="flex"><span>bash</span><button type="button" aria-label="Copier"><svg width="16" height="16"><path d="M0 0"></path></svg></button></div>',
  '<pre class="code-block__code" dir="auto"><code class="language-bash"><span class="token">ls</span> -la\n<span class="token">cd</span> /tmp</code></pre></div>',
  '<pre id="x" style="margin: 0" dir="auto"></pre>',
  '<pre dir="auto"><div>ligne 1</div><div>ligne 2</div></pre>',
  '<table dir="auto"><colgroup><col><col></colgroup><tbody>',
  '<tr><th><p></p></th><th><p></p></th></tr>',
  "<tr><td><p><strong>Jour</strong></p></td><td><p><strong>Menu</strong></p></td></tr>",
  "<tr><td><p>Lundi</p></td><td><p>Soupe</p></td></tr>",
  "</tbody></table>",
  '<hr dir="auto">',
  '<p dir="auto">Voir <a href="https://example.com/crepes" target="_blank" rel="noopener noreferrer">la recette</a> et <a href="javascript:alert(1)">ce lien</a>.<br><br>Fin.</p>',
  '<p dir="auto"><img src="https://example.com/photo.jpg"></p>',
  '<ul data-type="taskList"><li data-checked="true" data-type="taskItem" dir="auto"><label><input type="checkbox"></label><div dir="auto"><p dir="auto">Acheter du lait</p></div></li>',
  '<li data-checked="false" data-type="taskItem" dir="auto"><label><input type="checkbox"></label><div dir="auto"><p dir="auto">Sortir le chien</p></div></li></ul>',
  '<p dir="auto">-- ------ ----</p>',
  '<div dir="auto"><div dir="auto"><span style="white-space: pre;">   </span><br></div></div>',
].join("");

export const ADVANCED_CHECKLIST = {
  schemaVersion: "1.0.0",
  groups: [
    {
      name: "Jardin",
      collapsed: false,
      lastActive: "2025-04-02T10:00:00.000Z",
      sections: [
        { id: "open-tasks", name: "Open", collapsed: false },
        { id: "completed-tasks", name: "Completed", collapsed: false },
      ],
      tasks: [
        { id: "t1", description: "Tondre la pelouse", completed: true, createdAt: "2025-04-01T10:00:00.000Z", completedAt: "2025-04-02T10:00:00.000Z" },
        { id: "t2", description: "Planter les tomates\npas avant mai", completed: false, createdAt: "2025-04-01T10:01:00.000Z" },
        { id: "t3", description: "Arroser *tous* les soirs", completed: false, createdAt: "2025-04-01T10:02:00.000Z" },
      ],
    },
    {
      name: "Garage",
      collapsed: false,
      draft: "Ranger les outils",
      sections: [
        { id: "open-tasks", name: "Open", collapsed: false },
        { id: "completed-tasks", name: "Completed", collapsed: false },
      ],
      tasks: [],
    },
    { name: "Grenier", collapsed: false, sections: [], tasks: [] },
  ],
  defaultSections: [
    { id: "open-tasks", name: "Open" },
    { id: "completed-tasks", name: "Completed" },
  ],
};

export const PLAIN_TEXT = [
  "Caractères spéciaux pour le test :",
  "1- a*b_c<d>#e|f[g]\\h",
  "2- x__y__z ~~w~~ `v`",
  "  indenté de deux espaces",
  "\tavec une tabulation",
  "",
  "",
  "# pas un titre",
  "- pas une puce",
  "> pas une citation",
  "<b>pas du HTML</b> & co   ",
  "--- ",
].join("\n");

const SN = "org.standardnotes.sn";

/** A Note item; `content` overrides the defaults. */
function note(uuid: string, content: Record<string, unknown>, dates: Record<string, unknown> = {}) {
  return {
    uuid,
    content_type: "Note",
    created_at: "2024-03-01T10:00:00.250Z",
    created_at_timestamp: 1709287200250000,
    updated_at: "2025-06-12T08:30:04.512Z",
    updated_at_timestamp: 1749717004512000,
    deleted: false,
    duplicate_of: null,
    ...dates,
    content: {
      references: [],
      preview_plain: "",
      appData: { [SN]: { client_updated_at: "2025-06-12T08:30:00.000Z" } },
      ...content,
    },
  };
}

export const IDS = {
  html: "11111111-1111-4111-8111-111111111111",
  super: "22222222-2222-4222-8222-222222222222",
  advanced: "33333333-3333-4333-8333-333333333333",
  simple: "44444444-4444-4444-8444-444444444444",
  plain: "55555555-5555-4555-8555-555555555555",
  php: "66666666-6666-4666-8666-666666666666",
  sql: "77777777-7777-4777-8777-777777777777",
  markdown: "88888888-8888-4888-8888-888888888888",
  sheet: "99999999-9999-4999-8999-999999999999",
  trashed: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deleted: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  conflict: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
  undated: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

export const BACKUP = {
  version: "004",
  items: [
    { uuid: "f0000000-0000-4000-8000-000000000001", content_type: "SN|UserPreferences", content: { appData: {} } },
    { uuid: "f0000000-0000-4000-8000-000000000002", content_type: "SN|Component", content: { name: "Advanced Checklist", area: "editor-editor" } },
    { uuid: "f0000000-0000-4000-8000-000000000003", content_type: "SN|File", content: { name: "photo.jpg", key: "not-a-real-key", mimeType: "image/jpeg" } },
    note(IDS.html, {
      title: "Recette",
      text: RICH_TEXT_HTML,
      noteType: "rich-text",
      editorIdentifier: "org.standardnotes.plus-editor",
      spellcheck: true,
      preview_html: "<p>Recette</p>",
      appData: {
        [SN]: { client_updated_at: "2026-04-01T08:00:00.000Z", pinned: true },
        "org.standardnotes.sn.components": { "org.standardnotes.plus-editor": {} },
      },
    }),
    note(IDS.super, {
      title: "Voyage",
      text: JSON.stringify(LEXICAL_STATE),
      noteType: "super",
      editorIdentifier: "com.standardnotes.super-editor",
    }),
    note(
      IDS.advanced,
      {
        title: "Maison",
        text: JSON.stringify(ADVANCED_CHECKLIST, null, 2),
        noteType: "task",
        editorIdentifier: "com.sncommunity.advanced-checklist",
        conflict_of: "00000000-0000-4000-8000-0000000000ff",
        appData: { [SN]: { client_updated_at: "2025-05-20T09:15:00.000Z" }, "org.standardnotes.sn.components": { "f0000000-0000-4000-8000-000000000002": {} } },
      },
      { duplicate_of: "00000000-0000-4000-8000-0000000000ff" },
    ),
    note(IDS.simple, {
      title: "Courses",
      text: "- [ ] Pain\n- [x] Lait\n- [ ] Beurre *doux*\n- [ ] ",
      noteType: "task",
      editorIdentifier: "org.standardnotes.simple-task-editor",
      unsavedTask: "",
    }),
    note(IDS.plain, { title: "Symboles", text: PLAIN_TEXT, noteType: "plain-text", editorIdentifier: "com.standardnotes.plain-text" }),
    note(IDS.php, {
      title: "Bonjour en PHP",
      text: "<?php\necho 'Bonjour';\r\n",
      noteType: "code",
      editorIdentifier: "org.standardnotes.code-editor",
      appData: { [SN]: {}, "org.standardnotes.sn.components": { "org.standardnotes.code-editor": { mode: "application/x-httpd-php" } } },
    }),
    note(IDS.sql, { title: "", text: "SELECT title\nFROM notes\nWHERE pinned = 1;", noteType: "code" }),
    note(IDS.markdown, {
      title: "Mémo Markdown",
      text: "# Titre\n\n* un\n* deux\n\n__gras__ et <span>du HTML</span>\n\n```html\n<b>gardé dans le code</b>\n```",
      editorIdentifier: "org.standardnotes.advanced-markdown-editor",
    }),
    note(IDS.sheet, { title: "Budget", text: '{"sheets":[{"rows":[]}]}', noteType: "spreadsheet", editorIdentifier: "org.standardnotes.standard-sheets" }),
    note(IDS.trashed, { title: "Vieille note", text: "<p>À jeter</p>", noteType: "rich-text", trashed: true }),
    { uuid: IDS.deleted, content_type: "Note", deleted: true, created_at: "2024-01-01T00:00:00.000Z", updated_at: "2024-01-02T00:00:00.000Z" },
    note(IDS.conflict, { title: "Titre\nsur deux lignes", text: "Copie de conflit", noteType: "plain-text" }, { duplicate_of: IDS.plain }),
    {
      uuid: IDS.undated,
      content_type: "Note",
      content: { title: "Sans date", text: "Texte", appData: {} },
    },
  ],
};

/** The backup as `read_import_file` (Rust) gives it: the notes, and the count of the rest. */
export function backupFromRust(items: Array<Record<string, unknown>> = BACKUP.items) {
  const notes = items.filter((item) => item.content_type === "Note");
  const otherItems: Record<string, number> = {};
  for (const item of items) {
    if (item.content_type === "Note") continue;
    const type = String(item.content_type);
    otherItems[type] = (otherItems[type] ?? 0) + 1;
  }
  return { version: "004", notes, otherItems };
}
