const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Short relative date for the note list: « à l'instant », « 12 min », « 5 h », « 2 j », « 3 sem ». */
export function shortRelativeDate(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE) return "à l'instant";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)} j`;
  if (elapsed < MONTH) return `${Math.floor(elapsed / WEEK)} sem`;
  if (elapsed < YEAR) return `${Math.floor(elapsed / MONTH)} mois`;
  const years = Math.floor(elapsed / YEAR);
  return `${years} an${years > 1 ? "s" : ""}`;
}

// Creating a formatter is slow: one is shared by every card of the list.
const FULL_DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

/** Full date for tooltips: « 22 octobre 2026 à 14:05 ». */
export function fullDate(timestamp: number): string {
  return FULL_DATE.format(timestamp);
}
