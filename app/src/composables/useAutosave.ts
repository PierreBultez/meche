import { onBeforeUnmount } from "vue";

export interface AutosaveOptions<T> {
  /** Reads the current value (called only when saving, never on each keystroke). */
  read: () => T;
  /**
   * Writes a value that differs from the last one written. `expected` is the value this
   * autosave believes is stored: Rust refuses to overwrite another one (a version brought by
   * the sync) and keeps the new value in a conflict copy instead (docs/04). Resolves with
   * `false` when the value was kept elsewhere: what is stored did not change, so the next
   * writes still expect the same value (and are kept elsewhere too) until `reset`.
   */
  write: (value: T, expected: T) => Promise<boolean | void>;
  /** The value already stored, so that opening a note never saves it again. */
  initial: T;
  /** Whether two values are the same (`===` by default). */
  same?: (a: T, b: T) => boolean;
  /** Quiet time after the last change before saving (docs/05: 400 ms). */
  delay?: number;
  onError?: (error: unknown) => void;
}

export interface Autosave<T = string> {
  /** Call on every change: the save happens `delay` ms after the last one. */
  touch: () => void;
  /**
   * Saves now if something changed (leaving the note, closing the window). Rejects when the
   * text could not be saved, so that the caller can keep the note open instead of losing it.
   */
  flush: () => Promise<void>;
  /**
   * Replaces the stored value by the editor's own version of it, read right after loading.
   * A note written in another Markdown style is then only rewritten after a real change.
   */
  rebase: (value: T) => void;
  /**
   * Whether `value` is one this autosave knows: the stored one, or one of its writes on the
   * way. Any other value of the note was written by someone else (the sync).
   */
  knows: (value: T) => boolean;
  /** Something was typed and not read yet (it will be saved by the next flush). */
  pending: () => boolean;
  /**
   * The editor now shows `shown`, its form of the value `stored` (the version brought by the
   * sync, shown in place). Only once everything typed was flushed and nothing is pending.
   */
  reset: (stored: T, shown: T) => void;
}

/** Every autosave of an open note, so that leaving it or closing the window can flush them.
 * Only their `flush` is used here, whatever the type of their value. */
const alive = new Set<{ flush: () => Promise<void> }>();
/** Last writes of notes that were just closed, still on their way to Rust. */
const closing = new Set<Promise<void>>();

/** Counts the series of failed saves: a new series starts when a save fails after a success. */
let failureSeries = 0;

/** The current series of failed saves (the window refuses to close once per series). */
export function saveFailureSeries(): number {
  return failureSeries;
}

/** Saves everything typed. Rejects if something could not be saved (it is still on screen). */
export async function flushAllAutosaves(): Promise<void> {
  const results = await Promise.allSettled([
    ...[...alive].map((autosave) => autosave.flush()),
    ...closing,
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

/** Debounced save that only writes real changes. `T`: the type of the value saved. */
export function createAutosave<T>(
  options: AutosaveOptions<T>,
): Autosave<T> & { dispose: () => void } {
  const delay = options.delay ?? 400;
  const same = options.same ?? ((a: T, b: T) => a === b);
  /** The last value sent to Rust (or known to be stored, or kept elsewhere). */
  let lastWritten = options.initial;
  /** The last value known to be stored or kept, in the editor's form (see rebase). */
  let lastSaved = options.initial;
  /** The value really stored in Rust, as Rust has it: sent as `expected` with each write. */
  let stored = options.initial;
  /** Values written and not acknowledged yet (in order). */
  const inFlight: T[] = [];
  /** Something was typed since the value was last read. */
  let changed = false;
  /** The error of the last write, until a later write succeeds. */
  let failure: unknown = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (changed) {
      changed = false;
      const value = options.read();
      if (same(value, lastSaved) && same(value, lastWritten)) {
        // Back to what is stored (Ctrl+Z after a refused paste): nothing is left unsaved.
        failure = null;
      } else if (!same(value, lastWritten)) {
        lastWritten = value;
        inFlight.push(value);
        const settle = () => inFlight.splice(inFlight.indexOf(value), 1);
        // Writes are chained so that they reach Rust in order; each one expects what the
        // previous one stored. `stored` is read when the write starts, not now.
        writing = writing
          .then(() => options.write(value, stored))
          .then(
            (result) => {
              settle();
              // Kept elsewhere (a conflict copy): the note still holds the same value, which
              // the editor does not show. Expecting it again keeps every later write from
              // overwriting it, until the editor shows it (reset).
              if (result !== false) stored = value;
              lastSaved = value;
              failure = null;
            },
            (error: unknown) => {
              settle();
              // Not saved: the next flush tries again.
              if (lastWritten === value) {
                lastWritten = lastSaved;
                changed = true;
              }
              // Said once per series: the following attempts fail the same way, and whoever
              // flushes (leaving the note, closing the window) is told by the rejection.
              if (failure === null) {
                failureSeries++;
                options.onError?.(error);
              }
              failure = error;
            },
          );
      }
    }
    await writing;
    if (failure !== null) throw failure;
  }

  function touch(): void {
    changed = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
    // Errors are reported by onError; a later flush says whether the text is saved.
    timer = setTimeout(() => void flush().catch(() => undefined), delay);
  }

  function rebase(value: T): void {
    if (changed) return;
    lastWritten = value;
    lastSaved = value;
  }

  function knows(value: T): boolean {
    return same(value, stored) || inFlight.some((written) => same(written, value));
  }

  function reset(storedNow: T, shown: T): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    changed = false;
    failure = null;
    stored = storedNow;
    lastWritten = shown;
    lastSaved = shown;
  }

  const autosave: Autosave<T> = {
    touch,
    flush,
    rebase,
    knows,
    pending: () => changed,
    reset,
  };
  alive.add(autosave);
  return {
    ...autosave,
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      alive.delete(autosave);
    },
  };
}

/**
 * `createAutosave` for a component. When the component unmounts, its value is read one last
 * time (the editor still exists), then only that write is waited for by flushAllAutosaves.
 */
export function useAutosave<T>(options: AutosaveOptions<T>): Autosave<T> {
  const autosave = createAutosave(options);
  onBeforeUnmount(() => {
    const last = autosave.flush();
    autosave.dispose();
    closing.add(last);
    void last.catch(() => undefined).finally(() => closing.delete(last));
  });
  return autosave;
}
