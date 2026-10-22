import type { NoteKind } from "../types/note";
import { codeFence } from "./code-fence";

/**
 * The note as Markdown, for « Copier en Markdown »: a rich note already is Markdown, a code note
 * becomes a fenced code block (same rule as the conversion code → rich in Rust).
 */
export function noteAsMarkdown(kind: NoteKind, content: string, language: string | null): string {
  if (kind === "rich") return content;
  const fence = codeFence(content);
  const info = language && language !== "plaintext" ? language : "";
  return `${fence}${info}\n${content.replace(/\n$/, "")}\n${fence}`;
}
