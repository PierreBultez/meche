// Language of a code note imported from Standard Notes (docs/07): the one saved by its editor
// when there is one, otherwise a simple guess from the code, otherwise plain text.
import { normalizeLanguage } from "../editor/languages";

/** Names used by the CodeMirror modes of the Standard Notes code editor, and MIME types. */
const MODE_NAMES: Record<string, string> = {
  "application/x-httpd-php": "php",
  "text/x-php": "php",
  htmlmixed: "vue",
  "text/html": "vue",
  "text/x-sql": "sql",
  "text/x-mysql": "sql",
  "text/x-pgsql": "sql",
  "text/x-sh": "bash",
  "application/x-sh": "bash",
  "application/json": "json",
  "application/ld+json": "json",
  "text/javascript": "javascript",
  "application/javascript": "javascript",
  "text/typescript": "typescript",
  "application/typescript": "typescript",
  "text/x-rustsrc": "rust",
  "text/x-python": "python",
  "text/x-yaml": "yaml",
  "text/x-markdown": "markdown",
  gfm: "markdown",
  "text/css": "css",
  "text/x-scss": "css",
  "application/xml": "xml",
  "text/xml": "xml",
};

/** A language name as an editor may have saved it, as one of Mèche's languages (or null). */
export function languageFromName(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  const lower = name.trim().toLowerCase();
  return MODE_NAMES[lower] ?? normalizeLanguage(lower);
}

/** The language saved in the note's `appData` by its editor (`mode`, `language`…), if any. */
export function languageFromAppData(appData: unknown): string | null {
  if (!appData || typeof appData !== "object") return null;
  const components = (appData as Record<string, unknown>)["org.standardnotes.sn.components"];
  if (!components || typeof components !== "object") return null;
  for (const data of Object.values(components as Record<string, unknown>)) {
    if (!data || typeof data !== "object") continue;
    for (const key of ["mode", "language", "lang", "syntax"]) {
      const language = languageFromName((data as Record<string, unknown>)[key]);
      if (language) return language;
    }
  }
  return null;
}

/** First rule that matches the code wins: the most telling signs first. */
const GUESSES: Array<[string, (code: string) => boolean]> = [
  ["php", (code) => /<\?php/.test(code)],
  ["xml", (code) => /^\s*<\?xml/.test(code)],
  ["vue", (code) => /<template[\s>]|<script\s+setup|<!doctype html|<html[\s>]/i.test(code)],
  ["bash", (code) => /^#!.*\b(ba|z)?sh\b/.test(code)],
  ["python", (code) => /^#!.*\bpython/.test(code)],
  ["json", isJson],
  ["rust", (code) => /\bfn\s+\w+\s*[(<]/.test(code) && /\blet\s+mut\b|->|\bimpl\b|\bpub\s+fn\b|::/.test(code)],
  [
    "sql",
    (code) =>
      /^\s*(select\s[\s\S]+\sfrom\s|insert\s+into\s|update\s+\w+\s+set\s|delete\s+from\s|create\s+(table|index|database|view)\s|alter\s+table\s|drop\s+table\s)/im.test(
        code,
      ),
  ],
  ["python", (code) => /^\s*(def\s+\w+\s*\(.*\)\s*:|from\s+[\w.]+\s+import\s|class\s+\w+(\(.*\))?\s*:)/m.test(code)],
  ["typescript", (code) => /\binterface\s+\w+\s*\{|\bimport\s+type\b|:\s*(string|number|boolean)\b[;,)=]/.test(code)],
  ["javascript", (code) => /\b(const|let|var)\s+\w+\s*=|=>|\bfunction\b|console\.log|require\(/.test(code)],
  ["css", (code) => /^\s*[.#@:\w][^{}\n]*\{[^{}]*\b[\w-]+\s*:[^;{}]+;[^{}]*\}/m.test(code)],
  ["bash", (code) => /^\s*(\$\s|sudo\s|apt(-get)?\s|cd\s|echo\s|export\s\w+=|chmod\s|systemctl\s)/m.test(code)],
  ["yaml", isYaml],
  ["markdown", (code) => /^#{1,6}\s\S/m.test(code) || /^\s*[-*]\s\[[ xX]\]\s/m.test(code)],
];

function isJson(code: string): boolean {
  const trimmed = code.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Most non-empty lines are `key: value`, a list item or a `---` separator. */
function isYaml(code: string): boolean {
  const lines = code.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (lines.length < 2) return false;
  const yamlish = lines.filter((line) => /^\s*([\w.-]+:(\s|$)|-\s|---\s*$)/.test(line));
  return yamlish.length / lines.length >= 0.8;
}

/** A guess from the code itself; `plaintext` when nothing is sure enough. */
export function guessLanguage(code: string): string {
  return GUESSES.find(([, test]) => test(code))?.[0] ?? "plaintext";
}
