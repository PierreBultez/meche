// From the notes of a backup to the notes to import, with the summary (docs/07, section 4).
// Everything read from the backup is checked: it comes from a file.
import type { JSONContent } from "@tiptap/core";
import { Marked } from "marked";
import { advancedChecklistToDoc, isAdvancedChecklist, simpleTasksToDoc } from "./checklists";
import { guessLanguage, languageFromAppData } from "./code-language";
import { cleanDoc } from "./doc";
import { htmlToDoc } from "./html";
import { lexicalText, lexicalToDoc } from "./lexical";
import { MarkdownWriter } from "./markdown-writer";
import { plainTextToDoc } from "./plain-text";
import type { Backup, ImportPlan, ImportWarning, ImportedNote, PlannedNote, SourceFormat } from "./types";

/** Limits of docs/03, checked again by Rust (db/import.rs). */
export const MAX_TITLE_CHARS = 500;
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_ID_CHARS = 100;
/** The last date JavaScript can hold (year 275760): a later one is not a date. */
const MAX_DATE_MS = 8.64e15;

/** Editors of Standard Notes, for notes saved before `noteType` existed. */
const NOTE_TYPE_OF_EDITOR: Record<string, string> = {
  "com.standardnotes.super-editor": "super",
  "org.standardnotes.plus-editor": "rich-text",
  "org.standardnotes.bold-editor": "rich-text",
  "org.standardnotes.simple-task-editor": "task",
  "com.sncommunity.advanced-checklist": "task",
  "org.standardnotes.advanced-checklist": "task",
  "org.standardnotes.code-editor": "code",
  "org.standardnotes.simple-markdown-editor": "markdown",
  "org.standardnotes.advanced-markdown-editor": "markdown",
  "org.standardnotes.fancy-markdown-editor": "markdown",
  "org.standardnotes.minimal-markdown-editor": "markdown",
  "org.standardnotes.markdown-visual-editor": "markdown",
  "org.standardnotes.token-vault": "authentication",
  "org.standardnotes.standard-sheets": "spreadsheet",
  "com.standardnotes.plain-text": "plain-text",
};

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export interface PlanOptions {
  /** The time of the import, in ms (tests give a fixed one). */
  now?: number;
  /** After each note: the notes converted, and how many the backup holds. */
  onProgress?: (done: number, total: number) => void;
  /** Stops the conversion (the user left the page): the promise then fails with its reason. */
  signal?: AbortSignal;
}

/** Converting longer than this without a pause would freeze the page (docs/08). */
const WORK_MS = 40;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Converts every note of `backup`. A big backup takes a few seconds: the conversion pauses
 * between notes, so that the page keeps drawing and answering the keyboard.
 */
export async function planImport(backup: Backup, options: PlanOptions = {}): Promise<ImportPlan> {
  const now = options.now ?? Date.now();
  options.signal?.throwIfAborted();
  const plan: ImportPlan = {
    notes: [],
    skipped: { trashed: 0, deleted: 0, unreadable: 0 },
    otherItems: { ...backup.otherItems },
  };
  const writer = new MarkdownWriter();
  try {
    let worked = performance.now();
    for (const [index, item] of backup.notes.entries()) {
      if (performance.now() - worked > WORK_MS) {
        await pause();
        options.signal?.throwIfAborted();
        worked = performance.now();
      }
      planItem(item, plan, writer, now);
      options.onProgress?.(index + 1, backup.notes.length);
    }
  } finally {
    writer.destroy();
  }
  return plan;
}

/** One item of the backup: a note to import, or a reason to leave it out. */
function planItem(item: unknown, plan: ImportPlan, writer: MarkdownWriter, now: number): void {
  const sourceId = isRecord(item) ? asString(item.uuid).trim().toLowerCase() : "";
  // An id Rust would refuse (it checks it again) is not one: the whole import would fail.
  if (!isRecord(item) || !sourceId || Array.from(sourceId).length > MAX_SOURCE_ID_CHARS) {
    plan.skipped.unreadable += 1;
  } else if (item.deleted === true) {
    plan.skipped.deleted += 1;
  } else if (!isRecord(item.content) || item.errorDecrypting === true) {
    plan.skipped.unreadable += 1;
  } else if (item.content.trashed === true) {
    plan.skipped.trashed += 1;
  } else {
    try {
      plan.notes.push(planNote(sourceId, item, item.content, writer, now));
    } catch {
      // A note the converters did not expect (the backup is a file): the others still go in.
      plan.skipped.unreadable += 1;
    }
  }
}

function planNote(sourceId: string, item: Fields, content: Fields, writer: MarkdownWriter, now: number): PlannedNote {
  const warnings: ImportWarning[] = [];
  const appData = isRecord(content.appData) ? content.appData : {};
  const sn = isRecord(appData["org.standardnotes.sn"]) ? appData["org.standardnotes.sn"] : {};
  const text = asString(content.text).replace(/\r\n?/g, "\n");
  const editor = asString(content.editorIdentifier);
  // `hasOwn`: an editor named « constructor » must not find what every object has.
  const noteType =
    asString(content.noteType) || (Object.hasOwn(NOTE_TYPE_OF_EDITOR, editor) ? NOTE_TYPE_OF_EDITOR[editor] : "plain-text");

  let format: SourceFormat;
  let kind: ImportedNote["kind"] = "rich";
  let codeLanguage: string | null = null;
  let body: string;
  switch (noteType) {
    case "code":
      format = "code";
      kind = "code";
      body = text;
      codeLanguage = languageFromAppData(appData) ?? guessLanguage(text);
      break;
    case "super":
      format = "super";
      body = superNote(text, writer, warnings);
      break;
    case "rich-text": {
      format = "html";
      const { doc, sourceText } = htmlToDoc(text, writer.schema, warnings);
      body = rich(doc, sourceText, true, writer, warnings);
      break;
    }
    case "task":
      format = "checklist";
      body = isAdvancedChecklist(text)
        ? rich(...docAndText(advancedChecklistToDoc(text)), false, writer, warnings)
        : rich(...docAndText(simpleTasksToDoc(text, asString(content.unsavedTask))), false, writer, warnings);
      break;
    case "markdown":
      format = "markdown";
      body = markdownNote(text, writer, warnings);
      break;
    case "plain-text":
      format = "text";
      body = rich(plainTextToDoc(text), text, false, writer, warnings);
      break;
    default:
      // A spreadsheet, an authenticator…: its content (JSON) is kept, in a code note.
      format = "other";
      kind = "code";
      body = text;
      codeLanguage = "plaintext";
      warnings.push({ code: "unknown_type", detail: noteType });
  }

  // One line. `split` rather than a regular expression around "\n": linear on any title.
  let title = asString(content.title)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (Array.from(title).length > MAX_TITLE_CHARS) {
    title = Array.from(title).slice(0, MAX_TITLE_CHARS).join("");
    warnings.push({ code: "title_cut" });
  }
  const importable = new TextEncoder().encode(body).length <= MAX_CONTENT_BYTES;
  if (!importable) warnings.push({ code: "too_large" });

  const created = isoDate(item.created_at) ?? microseconds(item.created_at_timestamp);
  // The user's last change, the one Standard Notes shows; `updated_at` also moves with a sync.
  const updated = isoDate(sn.client_updated_at) ?? isoDate(item.updated_at) ?? microseconds(item.updated_at_timestamp);
  return {
    note: {
      sourceId,
      title,
      content: body,
      kind,
      codeLanguage,
      pinned: content.pinned === true || sn.pinned === true,
      createdAt: created ?? updated ?? now,
      updatedAt: updated ?? created ?? now,
    },
    format,
    warnings: dedupe(warnings),
    importable,
  };
}

const docAndText = (converted: { doc: JSONContent; sourceText: string }): [JSONContent, string] => [
  converted.doc,
  converted.sourceText,
];

/**
 * The Markdown of a converted rich note. When the editor's schema refuses the document (it
 * should not happen), the text of the note is imported as plain text, and reported.
 */
function rich(
  doc: JSONContent,
  sourceText: string,
  collapseSpaces: boolean,
  writer: MarkdownWriter,
  warnings: ImportWarning[],
): string {
  try {
    const written = writer.write(cleanDoc(doc, { collapseSpaces, warnings }), sourceText);
    if (!written.exact) warnings.push({ code: "not_exact" });
    return written.markdown;
  } catch {
    warnings.push({ code: "unreadable" });
    return writer.write(cleanDoc(plainTextToDoc(sourceText), { collapseSpaces: false }), sourceText).markdown;
  }
}

function superNote(text: string, writer: MarkdownWriter, warnings: ImportWarning[]): string {
  if (!text.trim()) return "";
  let doc: JSONContent;
  try {
    doc = lexicalToDoc(text, warnings);
  } catch {
    // Not a Lexical state: an old Super note keeps its text as it is.
    warnings.push({ code: "unreadable" });
    return rich(plainTextToDoc(text), text, false, writer, warnings);
  }
  return rich(doc, lexicalText(text), false, writer, warnings);
}

/**
 * What a Markdown note holds that rich notes do not keep (docs/05), and that the check below
 * cannot see, since it compares with the editor's own reading: HTML, images (their address is
 * lost, their description stays), footnotes.
 */
function markdownLosses(text: string): ImportWarning[] {
  const parser = new Marked();
  const warnings: ImportWarning[] = [];
  parser.walkTokens(parser.lexer(text), (token) => {
    if (token.type === "html") warnings.push({ code: "raw_html" });
    else if (token.type === "image") warnings.push({ code: "unsupported", detail: "image" });
    else if (token.type === "def" && String(token.tag).startsWith("^")) warnings.push({ code: "unsupported", detail: "footnote" });
  });
  return warnings;
}

function markdownNote(text: string, writer: MarkdownWriter, warnings: ImportWarning[]): string {
  warnings.push(...markdownLosses(text));
  const doc = writer.read(text);
  // The text to keep is what the editor reads in the Markdown: the check is the round trip.
  const sourceText = writer.schema.nodeFromJSON(doc).textContent;
  return rich(doc, sourceText, false, writer, warnings);
}

/** A date in ms after 1970, or null. Time 0 is a missing date written as one (« il y a 56 ans »). */
function plausibleDate(time: number): number | null {
  return Number.isFinite(time) && time > 0 && time <= MAX_DATE_MS ? Math.floor(time) : null;
}

function isoDate(value: unknown): number | null {
  return typeof value === "string" ? plausibleDate(Date.parse(value)) : null;
}

/** `created_at_timestamp` and `updated_at_timestamp` are in microseconds. */
function microseconds(value: unknown): number | null {
  return typeof value === "number" ? plausibleDate(value / 1000) : null;
}

function dedupe(warnings: ImportWarning[]): ImportWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.detail ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The notes `import_notes` receives. */
export function notesToImport(plan: ImportPlan): ImportedNote[] {
  return plan.notes.filter((planned) => planned.importable).map((planned) => planned.note);
}
