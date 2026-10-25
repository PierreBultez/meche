// The texts of the import summary (docs/07, section 4), in French: « 25 notes trouvées : 9 textes
// enrichis, 6 Super… », what could not be kept exactly, what is left out.
import type { ImportPlan, ImportWarning, SourceFormat } from "./types";

const FORMATS: Array<[SourceFormat, string, string]> = [
  ["text", "texte", "textes"],
  ["markdown", "Markdown", "Markdown"],
  ["html", "texte enrichi", "textes enrichis"],
  ["super", "Super", "Super"],
  ["checklist", "checklist", "checklists"],
  ["code", "note de code", "notes de code"],
  ["other", "autre", "autres"],
];

const count = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** « 25 notes trouvées : 3 textes, 9 textes enrichis, 6 Super, 7 checklists. » */
export function foundText(plan: ImportPlan): string {
  const total = plan.notes.length;
  if (total === 0) return "Aucune note à importer dans cette sauvegarde.";
  const parts = FORMATS.map(([format, one, many]) => {
    const n = plan.notes.filter((note) => note.format === format).length;
    return n ? count(n, one, many) : null;
  }).filter(Boolean);
  return `${count(total, "note trouvée", "notes trouvées")} : ${parts.join(", ")}.`;
}

const DROPPED: Record<string, string> = {
  img: "images ignorées",
  picture: "images ignorées",
  "inline-image": "images ignorées",
  image: "images ignorées",
  video: "vidéos ignorées",
  audio: "sons ignorés",
  iframe: "contenus intégrés ignorés",
  object: "contenus intégrés ignorés",
  embed: "contenus intégrés ignorés",
  canvas: "dessins ignorés",
  snfile: "fichiers joints ignorés",
  math: "formules ignorées",
  footnote: "notes de bas de page ignorées",
  // Lexical nodes holding text Mèche has no block for (collapsible sections…).
  layout: "mise en page simplifiée, le texte est gardé",
};

/** What happened to a note, in a few words (« images ignorées »). */
export function warningText(warning: ImportWarning): string {
  switch (warning.code) {
    case "not_exact":
      return "pas tout à fait à l'identique, à vérifier";
    case "unsupported": {
      return Object.hasOwn(DROPPED, warning.detail ?? "")
        ? DROPPED[warning.detail ?? ""]
        : `élément « ${warning.detail} » ignoré`;
    }
    case "unreadable":
      return "format inattendu, importée en texte brut";
    case "unknown_type":
      return `type « ${warning.detail} » inconnu, importée en note code`;
    case "raw_html":
      return "du HTML que Mèche ne garde pas (le texte reste)";
    case "title_cut":
      return "titre raccourci à 500 caractères";
    case "too_large":
      return "plus de 2 Mo : pas importée";
  }
}

/** The notes the summary lists: those with a warning. */
export function notesToCheck(plan: ImportPlan): Array<{ title: string; details: string; importable: boolean }> {
  return plan.notes
    .filter((note) => note.warnings.length > 0)
    .map((note) => ({
      title: note.note.title || "Sans titre",
      details: [...new Set(note.warnings.map(warningText))].join(" ; "),
      importable: note.importable,
    }));
}

/** « Pas importés : 2 notes de la corbeille de Standard Notes, 34 fichiers joints… » or null. */
export function leftOutText(plan: ImportPlan): string | null {
  const parts: string[] = [];
  const { trashed, deleted, unreadable } = plan.skipped;
  if (trashed) parts.push(count(trashed, "note de la corbeille de Standard Notes", "notes de la corbeille de Standard Notes"));
  if (deleted + unreadable) parts.push(count(deleted + unreadable, "note supprimée ou illisible", "notes supprimées ou illisibles"));
  const files = plan.otherItems["SN|File"] ?? 0;
  if (files) parts.push(`${count(files, "fichier joint", "fichiers joints")} (absents de la sauvegarde)`);
  const tags = (plan.otherItems["Tag"] ?? 0) + (plan.otherItems["SN|SmartTag"] ?? 0);
  if (tags) parts.push(`${count(tags, "étiquette", "étiquettes")} (Mèche n'en a pas)`);
  const rest = Object.entries(plan.otherItems)
    .filter(([type]) => !["SN|File", "Tag", "SN|SmartTag"].includes(type))
    .reduce((sum, [, n]) => sum + n, 0);
  if (rest) parts.push(count(rest, "réglage ou extension", "réglages et extensions"));
  return parts.length ? `Pas importés : ${parts.join(", ")}.` : null;
}

/** About 6 seconds per note (docs/07: 100 notes in about 10 minutes). */
export function triageMinutes(notes: number): number {
  return Math.max(1, Math.ceil((notes * 6) / 60));
}
