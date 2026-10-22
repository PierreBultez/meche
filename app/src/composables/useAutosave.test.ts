import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createAutosave, flushAllAutosaves, useAutosave } from "./useAutosave";

describe("autosave", () => {
  let value: string;
  let written: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    value = "initial";
    written = [];
  });

  afterEach(() => vi.useRealTimers());

  function setup() {
    return createAutosave({
      initial: "initial",
      read: () => value,
      write: async (next) => {
        written.push(next);
      },
    });
  }

  it("saves 400 ms after the last change", async () => {
    const autosave = setup();
    value = "a";
    autosave.touch();
    await vi.advanceTimersByTimeAsync(300);
    value = "ab";
    autosave.touch();
    await vi.advanceTimersByTimeAsync(300);
    expect(written).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(written).toEqual(["ab"]);
    autosave.dispose();
  });

  it("never writes a value equal to the last one", async () => {
    const autosave = setup();
    autosave.touch();
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toEqual([]);
    value = "x";
    autosave.touch();
    await autosave.flush();
    autosave.touch();
    await autosave.flush();
    expect(written).toEqual(["x"]);
    autosave.dispose();
  });

  it("never writes a note that was only opened (docs/05)", async () => {
    const autosave = setup();
    // The editor reads the stored Markdown differently (another list style…).
    value = "normalized";
    await autosave.flush();
    await flushAllAutosaves();
    expect(written).toEqual([]);
    autosave.dispose();
  });

  it("compares with the editor's own version of the stored text", async () => {
    const autosave = setup();
    autosave.rebase("normalized");
    // A transaction that changes nothing visible (TipTap's trailing paragraph).
    value = "normalized";
    autosave.touch();
    await autosave.flush();
    expect(written).toEqual([]);
    value = "normalized, then edited";
    autosave.touch();
    await autosave.flush();
    expect(written).toEqual(["normalized, then edited"]);
    autosave.dispose();
  });

  it("does not rebase once something was typed", async () => {
    const autosave = setup();
    value = "typed";
    autosave.touch();
    autosave.rebase("typed");
    await autosave.flush();
    expect(written).toEqual(["typed"]);
    autosave.dispose();
  });

  it("flushes immediately and cancels the pending timer", async () => {
    const autosave = setup();
    value = "now";
    autosave.touch();
    await autosave.flush();
    expect(written).toEqual(["now"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(written).toEqual(["now"]);
    autosave.dispose();
  });

  it("flushes every live autosave when the window closes", async () => {
    const first = setup();
    const second = createAutosave({
      initial: "",
      read: () => "second",
      write: async (next) => {
        written.push(next);
      },
    });
    value = "first";
    first.touch();
    second.touch();
    await flushAllAutosaves();
    expect(written.sort()).toEqual(["first", "second"]);
    first.dispose();
    second.dispose();
  });

  it("reports a failed write, rejects until it is saved, and retries", async () => {
    const errors: unknown[] = [];
    let fail = true;
    const autosave = createAutosave({
      initial: "",
      read: () => value,
      write: async (next) => {
        if (fail) throw new Error("disk full");
        written.push(next);
      },
      onError: (error) => errors.push(error),
    });
    value = "a";
    autosave.touch();
    await expect(autosave.flush()).rejects.toThrow("disk full");
    await expect(flushAllAutosaves()).rejects.toThrow("disk full");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    fail = false;
    await autosave.flush(); // same value: retried because the first write failed
    expect(written).toEqual(["a"]);
    await flushAllAutosaves();
    value = "b";
    autosave.touch();
    await autosave.flush();
    expect(written).toEqual(["a", "b"]);
    autosave.dispose();
  });

  it("debounced saves never leave an unhandled rejection", async () => {
    const errors: unknown[] = [];
    const autosave = createAutosave({
      initial: "",
      read: () => "x",
      write: async () => {
        throw new Error("nope");
      },
      onError: (error) => errors.push(error),
    });
    autosave.touch();
    await vi.advanceTimersByTimeAsync(500);
    expect(errors).toHaveLength(1);
    autosave.dispose();
  });
});

describe("useAutosave in a component", () => {
  it("reads the editor one last time on unmount, then never again", async () => {
    let value = "v1";
    let editorAlive = true;
    const written: string[] = [];
    let release!: () => void;
    const slowWrite = new Promise<void>((resolve) => (release = resolve));
    let autosave!: ReturnType<typeof useAutosave>;
    const Editor = defineComponent({
      setup() {
        autosave = useAutosave({
          initial: "v0",
          // Like NoteEditor: once the editor is gone, only stale props are left.
          read: () => (editorAlive ? value : "stale"),
          write: async (next) => {
            await slowWrite;
            written.push(next);
          },
        });
        return () => h("div");
      },
    });
    const wrapper = mount(Editor);
    autosave.touch();
    wrapper.unmount();
    editorAlive = false;
    value = "v2";
    // Leaving another note while the last write is still on its way.
    const flushing = flushAllAutosaves();
    release();
    await flushing;
    expect(written).toEqual(["v1"]);
  });
});
