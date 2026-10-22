/** The 8 note colors, stored by name (see docs/03 and docs/11). Same list as the SQLite CHECK. */
export const NOTE_COLORS = [
  "violet",
  "rose",
  "corail",
  "orange",
  "citron",
  "pomme",
  "turquoise",
  "bleu",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** Names shown in the interface. */
export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  violet: "Violet",
  rose: "Rose",
  corail: "Corail",
  orange: "Orange",
  citron: "Citron",
  pomme: "Pomme",
  turquoise: "Turquoise",
  bleu: "Bleu",
};
