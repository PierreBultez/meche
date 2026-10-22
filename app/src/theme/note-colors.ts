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
