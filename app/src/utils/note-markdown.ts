import type { NoteKind } from "../types/note";

/**
 * The note as Markdown, for « Copier en Markdown »: a rich note already is Markdown, a code note
 * becomes a fenced code block (same rule as the conversion code → rich in Rust).
 */
export function noteAsMarkdown(kind: NoteKind, content: string, language: string | null): string {
  if (kind === "rich") return content;
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  const info = language && language !== "plaintext" ? language : "";
  return `${fence}${info}\n${content.replace(/\n$/, "")}\n${fence}`;
}
