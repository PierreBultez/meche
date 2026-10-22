// Commands of the « / » menu (docs/05, "Menu « / »").
import type { Editor, Range } from "@tiptap/core";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  SquareCode,
  Table,
  TextQuote,
} from "lucide-vue-next";
import type { Component } from "vue";
import type { EditorState } from "@tiptap/pm/state";

export interface SlashCommand {
  label: string;
  /** Other words that find the command (« puce » finds « Liste »). */
  keywords: string[];
  icon: Component;
  run: (editor: Editor, range: Range) => void;
}

/** Removes the typed « /query » then runs the command. */
const start = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    label: "Titre 1",
    keywords: ["h1", "titre", "heading"],
    icon: Heading1,
    run: (editor, range) => start(editor, range).setNode("heading", { level: 1 }).run(),
  },
  {
    label: "Titre 2",
    keywords: ["h2", "titre", "sous-titre"],
    icon: Heading2,
    run: (editor, range) => start(editor, range).setNode("heading", { level: 2 }).run(),
  },
  {
    label: "Titre 3",
    keywords: ["h3", "titre"],
    icon: Heading3,
    run: (editor, range) => start(editor, range).setNode("heading", { level: 3 }).run(),
  },
  {
    label: "Liste",
    keywords: ["puces", "bullet", "ul"],
    icon: List,
    run: (editor, range) => start(editor, range).toggleBulletList().run(),
  },
  {
    label: "Liste numérotée",
    keywords: ["numéros", "ordered", "ol", "1."],
    icon: ListOrdered,
    run: (editor, range) => start(editor, range).toggleOrderedList().run(),
  },
  {
    label: "Checklist",
    keywords: ["cases", "tâches", "todo", "cocher"],
    icon: ListTodo,
    run: (editor, range) => start(editor, range).toggleTaskList().run(),
  },
  {
    label: "Bloc de code",
    keywords: ["code", "programme", "```"],
    icon: SquareCode,
    run: (editor, range) => start(editor, range).setCodeBlock().run(),
  },
  {
    label: "Citation",
    keywords: ["quote", "cite"],
    icon: TextQuote,
    run: (editor, range) => start(editor, range).setBlockquote().run(),
  },
  {
    label: "Tableau",
    keywords: ["table", "grille", "colonnes"],
    icon: Table,
    run: (editor, range) =>
      start(editor, range).insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(),
  },
  {
    label: "Séparateur",
    keywords: ["ligne", "trait", "hr", "---"],
    icon: Minus,
    run: (editor, range) => start(editor, range).setHorizontalRule().run(),
  },
];

/** Lowercase, without accents: « Numérotée » → « numerotee ». */
export function simplify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Commands matching what was typed after « / »: label or keyword starting with the query. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const wanted = simplify(query.trim());
  if (wanted === "") {
    return SLASH_COMMANDS;
  }
  return SLASH_COMMANDS.filter(({ label, keywords }) =>
    [label, ...label.split(" "), ...keywords].some((word) => simplify(word).startsWith(wanted)),
  );
}

/**
 * The menu opens at the start of a line only (docs/05): the start of a paragraph, or right after
 * a line break. Suggestion's own startOfLine only looks at the text node before "/", which also
 * starts right after a bold word or a link. Never in a code block nor in a table cell.
 */
export function slashAllowed({ state, range }: { state: EditorState; range: Range }): boolean {
  const $from = state.doc.resolve(range.from);
  if ($from.parent.type.spec.code) return false;
  // A table cell only holds paragraphs: none of the block commands would work there.
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === "tableCell" || name === "tableHeader") return false;
  }
  return $from.parentOffset === 0 || $from.nodeBefore?.type.name === "hardBreak";
}
