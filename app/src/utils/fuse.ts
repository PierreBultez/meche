// Texts of the fuse (« la mèche », docs/06 and docs/11). Rust decides when a note explodes; these
// helpers only say how long is left, for the list and the open note.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Delays offered in the settings (the same list as FUSE_DELAYS_HOURS in db/settings.rs). */
export const FUSE_DELAYS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 1, label: "1 heure" },
  { hours: 24, label: "24 heures" },
  { hours: 72, label: "3 jours" },
  { hours: 168, label: "7 jours" },
  { hours: 720, label: "30 jours" },
];

/** The label of a delay of the settings, « 7 jours ». */
export function fuseDelayLabel(hours: number): string {
  return FUSE_DELAYS.find((delay) => delay.hours === hours)?.label ?? `${hours} h`;
}

/** Under an hour left, the time is shown in --danger (docs/11). */
export function fuseIsShort(destroyAt: number, now: number): boolean {
  return destroyAt - now < HOUR;
}

/** Time left on a card of the list: « 2 j », « 5 h », « 12 min », « < 1 min ». */
export function fuseTimeLeft(destroyAt: number, now: number): string {
  const left = destroyAt - now;
  if (left >= DAY) return `${Math.floor(left / DAY)} j`;
  if (left >= HOUR) return `${Math.floor(left / HOUR)} h`;
  if (left >= MINUTE) return `${Math.floor(left / MINUTE)} min`;
  // Also once the time is up: Rust moves the note to the trash within a minute.
  return "< 1 min";
}

/** Time left in the open note: « Explose dans 2 j 4 h », « … dans 5 h 12 min ». */
export function fuseExplodesIn(destroyAt: number, now: number): string {
  const left = destroyAt - now;
  if (left < MINUTE) return "Explose dans moins d'une minute";
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const minutes = Math.floor((left % HOUR) / MINUTE);
  const parts =
    days > 0
      ? [`${days} j`, hours > 0 ? `${hours} h` : ""]
      : hours > 0
        ? [`${hours} h`, minutes > 0 ? `${minutes} min` : ""]
        : [`${minutes} min`];
  return `Explose dans ${parts.filter(Boolean).join(" ")}`;
}
