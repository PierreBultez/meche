import { onBeforeUnmount } from "vue";

export interface AutosaveOptions {
  /** Reads the current value (called only when saving, never on each keystroke). */
  read: () => string;
  /** Writes a value that differs from the last one written. */
  write: (value: string) => Promise<unknown>;
  /** The value already stored, so that opening a note never saves it again. */
  initial: string;
  /** Quiet time after the last change before saving (docs/05: 400 ms). */
  delay?: number;
  onError?: (error: unknown) => void;
}

export interface Autosave {
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
  rebase: (value: string) => void;
}

/** Every autosave of an open note, so that leaving it or closing the window can flush them. */
const alive = new Set<Autosave>();
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

/** Debounced save that only writes real changes. */
export function createAutosave(options: AutosaveOptions): Autosave & { dispose: () => void } {
  const delay = options.delay ?? 400;
  /** The last value sent to Rust (or known to be stored). */
  let lastWritten = options.initial;
  /** The last value known to be stored. */
  let lastSaved = options.initial;
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
      if (value === lastSaved && value === lastWritten) {
        // Back to what is stored (Ctrl+Z after a refused paste): nothing is left unsaved.
        failure = null;
      } else if (value !== lastWritten) {
        lastWritten = value;
        // Writes are chained so that they reach Rust in order.
        writing = writing
          .then(() => options.write(value))
          .then(
            () => {
              lastSaved = value;
              failure = null;
            },
            (error: unknown) => {
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

  function rebase(value: string): void {
    if (changed) return;
    lastWritten = value;
    lastSaved = value;
  }

  const autosave = { touch, flush, rebase };
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
export function useAutosave(options: AutosaveOptions): Autosave {
  const autosave = createAutosave(options);
  onBeforeUnmount(() => {
    const last = autosave.flush();
    autosave.dispose();
    closing.add(last);
    void last.catch(() => undefined).finally(() => closing.delete(last));
  });
  return autosave;
}
