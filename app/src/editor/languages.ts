/**
 * Languages offered for code notes and for code blocks of rich notes (docs/05, "Langages V1").
 * `id` is what we store: in `code_language` for code notes, after ``` in Markdown code blocks.
 */
export interface CodeLanguage {
  id: string;
  label: string;
  /** Other names accepted when reading Markdown (```ts, ```sh…). */
  aliases: string[];
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: "plaintext", label: "Texte brut", aliases: ["text", "txt", "plain"] },
  { id: "php", label: "PHP", aliases: [] },
  { id: "javascript", label: "JavaScript", aliases: ["js", "mjs", "cjs", "jsx"] },
  { id: "typescript", label: "TypeScript", aliases: ["ts", "tsx"] },
  { id: "vue", label: "Vue / HTML", aliases: ["html", "htm"] },
  { id: "css", label: "CSS", aliases: [] },
  { id: "sql", label: "SQL", aliases: ["mysql", "sqlite"] },
  { id: "rust", label: "Rust", aliases: ["rs"] },
  { id: "bash", label: "Bash", aliases: ["sh", "shell", "zsh", "console"] },
  { id: "json", label: "JSON", aliases: [] },
  { id: "yaml", label: "YAML", aliases: ["yml"] },
  { id: "markdown", label: "Markdown", aliases: ["md"] },
  { id: "xml", label: "XML", aliases: ["svg"] },
  { id: "python", label: "Python", aliases: ["py"] },
];

/** Maps any accepted name (id or alias, any case) to its language id; unknown names give null. */
export function normalizeLanguage(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  const lower = name.trim().toLowerCase();
  const language = CODE_LANGUAGES.find(({ id, aliases }) => id === lower || aliases.includes(lower));
  return language ? language.id : null;
}

export function languageLabel(name: string | null | undefined): string {
  const id = normalizeLanguage(name);
  return CODE_LANGUAGES.find((language) => language.id === id)?.label ?? (name || "Texte brut");
}
