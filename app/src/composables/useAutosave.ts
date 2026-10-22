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
  /** Saves now if something changed (leaving the note, closing the window). */
  flush: () => Promise<void>;
}

/** Every autosave alive, so that closing the window can flush them all. */
const alive = new Set<Autosave>();

export async function flushAllAutosaves(): Promise<void> {
  await Promise.all([...alive].map((autosave) => autosave.flush()));
}

/** Debounced save that only writes real changes. Flushes itself when the component unmounts. */
export function createAutosave(options: AutosaveOptions): Autosave & { dispose: () => void } {
  const delay = options.delay ?? 400;
  let lastWritten = options.initial;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const value = options.read();
    if (value === lastWritten) {
      return writing;
    }
    const previous = lastWritten;
    lastWritten = value;
    // Writes are chained so that they reach Rust in order.
    writing = writing
      .then(() => options.write(value))
      .then(
        () => undefined,
        (error: unknown) => {
          // Not saved: forget it, so that the next flush tries again.
          if (lastWritten === value) {
            lastWritten = previous;
          }
          options.onError?.(error);
        },
      );
    return writing;
  }

  function touch(): void {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => void flush(), delay);
  }

  const autosave = { touch, flush };
  alive.add(autosave);
  return {
    ...autosave,
    dispose: () => {
      alive.delete(autosave);
    },
  };
}

/** `createAutosave` for a component: flushed and released when the component unmounts. */
export function useAutosave(options: AutosaveOptions): Autosave {
  const autosave = createAutosave(options);
  onBeforeUnmount(() => {
    void autosave.flush().finally(autosave.dispose);
  });
  return autosave;
}
