// CodeMirror 6 setup of code notes (docs/05, "Note code").
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { normalizeLanguage } from "./languages";

/** The shared code theme of docs/11, through the same CSS variables as the rich notes. */
const highlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.operator],
    color: "var(--code-keyword)",
  },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.escape], color: "var(--code-string)" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.heading],
    color: "var(--code-function)",
  },
  { tag: [t.number, t.bool, t.null, t.atom, t.constant(t.variableName)], color: "var(--code-number)" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: "var(--code-type)" },
  {
    tag: [t.variableName, t.propertyName, t.attributeName, t.labelName, t.special(t.variableName)],
    color: "var(--code-variable)",
  },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "var(--brand)", textDecoration: "underline" },
]);

/** Colors from the tokens only: the editor follows the theme instantly. */
const theme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--code-bg)",
    color: "var(--code-text)",
    fontSize: "14px",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--code-text)", padding: "12px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--code-text)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--code-text) 5%, transparent)" },
  ".cm-gutters": {
    backgroundColor: "var(--code-bg)",
    color: "var(--code-comment)",
    border: "none",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--code-text)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--surface-2)",
    color: "var(--text-muted)",
    border: "none",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--selection)" },
  ".cm-searchMatch": { backgroundColor: "var(--selection)", outline: "1px solid var(--brand)" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--brand)", color: "var(--on-brand)" },
  ".cm-matchingBracket": { backgroundColor: "var(--selection)", color: "inherit" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--text)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel input, .cm-textfield": {
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--surface-2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
  },
  ".cm-panel.cm-search label": { color: "var(--text)" },
  ".cm-panel button[name=close]": { color: "var(--text)" },
});

/** French labels of CodeMirror's built-in panels (search, folding). */
const frenchPhrases = EditorState.phrases.of({
  Find: "Rechercher",
  Replace: "Remplacer",
  next: "suivant",
  previous: "précédent",
  all: "tout",
  "match case": "respecter la casse",
  regexp: "expression régulière",
  "by word": "mot entier",
  replace: "remplacer",
  "replace all": "tout remplacer",
  close: "fermer",
  "current match": "résultat actuel",
  "on line": "à la ligne",
  "Go to line": "Aller à la ligne",
  go: "aller",
  "Folded lines": "Lignes repliées",
  "Unfolded lines": "Lignes dépliées",
  to: "à",
  "folded code": "code replié",
  unfold: "déplier",
  "Fold line": "Replier",
  "Unfold line": "Déplier",
  "Selection deleted": "Sélection supprimée",
  "Control character": "Caractère de contrôle",
});

/** Line numbers, folding, search (Ctrl+F), history, indentation… without autocompletion. */
export function codeEditorSetup(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(highlightStyle),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    theme,
    frenchPhrases,
  ];
}

/**
 * Loads the language support of `name` on demand (docs/08: languages are not part of the
 * startup bundle). Unknown names and plain text give no extension.
 */
export async function loadLanguage(name: string | null): Promise<Extension | null> {
  switch (normalizeLanguage(name)) {
    case "php":
      return (await import("@codemirror/lang-php")).php();
    case "javascript":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "vue":
      return (await import("@codemirror/lang-vue")).vue();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "rust":
      return (await import("@codemirror/lang-rust")).rust();
    case "bash": {
      const [{ StreamLanguage }, { shell }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/shell"),
      ]);
      return StreamLanguage.define(shell);
    }
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "yaml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "xml":
      return (await import("@codemirror/lang-xml")).xml();
    case "python":
      return (await import("@codemirror/lang-python")).python();
    default:
      return null;
  }
}
