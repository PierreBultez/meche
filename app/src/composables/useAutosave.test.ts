import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import {
  type Autosave,
  createAutosave,
  flushAllAutosaves,
  saveFailureSeries,
  useAutosave,
} from "./useAutosave";

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

  it("sends with each value the one it believes is stored (docs/04)", async () => {
    const calls: Array<[string, string]> = [];
    const autosave = createAutosave({
      initial: "initial",
      read: () => value,
      write: async (next, expected) => {
        calls.push([next, expected]);
      },
    });
    value = "a";
    autosave.touch();
    await autosave.flush();
    value = "ab";
    autosave.touch();
    await autosave.flush();
    expect(calls).toEqual([
      ["a", "initial"],
      ["ab", "a"],
    ]);
    autosave.dispose();
  });

  it("expects the stored text, not the editor's form of it", async () => {
    const calls: Array<[string, string]> = [];
    const autosave = createAutosave({
      initial: "* stored",
      read: () => value,
      write: async (next, expected) => {
        calls.push([next, expected]);
      },
    });
    autosave.rebase("- stored");
    value = "- stored, edited";
    autosave.touch();
    await autosave.flush();
    expect(calls).toEqual([["- stored, edited", "* stored"]]);
    autosave.dispose();
  });

  it("keeps expecting the stored text after a write kept elsewhere", async () => {
    const calls: Array<[string, string]> = [];
    const autosave = createAutosave({
      initial: "initial",
      read: () => value,
      // Rust kept the version of another device, and the typed text in a copy.
      write: async (next, expected) => {
        calls.push([next, expected]);
        return false;
      },
    });
    value = "mine";
    autosave.touch();
    await autosave.flush();
    // Nothing new typed: not written again.
    autosave.touch();
    await autosave.flush();
    value = "mine, again";
    autosave.touch();
    await autosave.flush();
    // Still expects what this editor last saw stored: never written over the other version.
    expect(calls).toEqual([
      ["mine", "initial"],
      ["mine, again", "initial"],
    ]);
    expect(autosave.knows("mine")).toBe(false);
    autosave.dispose();
  });

  it("expects the new version once the editor shows it", async () => {
    const calls: Array<[string, string]> = [];
    const autosave = createAutosave({
      initial: "initial",
      read: () => value,
      write: async (next, expected) => {
        calls.push([next, expected]);
      },
    });
    // The sync brought « theirs »; the editor shows it in its own form.
    autosave.reset("theirs", "theirs (editor)");
    expect(autosave.knows("theirs")).toBe(true);
    value = "theirs (editor)";
    autosave.touch();
    expect(autosave.pending()).toBe(true);
    await autosave.flush();
    expect(calls).toEqual([]);
    value = "theirs, edited";
    autosave.touch();
    await autosave.flush();
    expect(calls).toEqual([["theirs, edited", "theirs"]]);
    autosave.dispose();
  });

  it("compares values with the given function", async () => {
    const calls: Array<[{ a: string }, { a: string }]> = [];
    let shown = { a: "x" };
    const autosave = createAutosave({
      initial: { a: "x" },
      read: () => shown,
      same: (one, other) => one.a === other.a,
      write: async (next, expected) => {
        calls.push([next, expected]);
      },
    });
    autosave.touch();
    await autosave.flush();
    expect(calls).toEqual([]);
    shown = { a: "y" };
    autosave.touch();
    await autosave.flush();
    expect(calls).toEqual([[{ a: "y" }, { a: "x" }]]);
    expect(autosave.knows({ a: "y" })).toBe(true);
    autosave.dispose();
  });

  it("knows the stored value and its writes on the way, nothing else", async () => {
    let release!: () => void;
    const autosave = createAutosave({
      initial: "initial",
      read: () => value,
      write: () => new Promise<void>((resolve) => (release = resolve)),
    });
    value = "typed";
    autosave.touch();
    const flushed = autosave.flush();
    await Promise.resolve();
    expect([autosave.knows("initial"), autosave.knows("typed"), autosave.knows("other")]).toEqual([
      true,
      true,
      false,
    ]);
    release();
    await flushed;
    expect([autosave.knows("typed"), autosave.knows("initial")]).toEqual([true, false]);
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

  it("stops refusing once the text is back to what is stored", async () => {
    let fail = true;
    const autosave = createAutosave({
      initial: "stored",
      read: () => value,
      write: async (next) => {
        if (fail) throw new Error("too big");
        written.push(next);
      },
    });
    value = "a 3 MB paste";
    autosave.touch();
    await expect(autosave.flush()).rejects.toThrow("too big");
    // Ctrl+Z: the editor shows the stored text again.
    value = "stored";
    autosave.touch();
    await autosave.flush();
    await flushAllAutosaves();
    expect(written).toEqual([]);
    // A text that really is too big is still refused.
    value = "another 3 MB paste";
    autosave.touch();
    await expect(autosave.flush()).rejects.toThrow("too big");
    fail = false;
    await autosave.flush();
    expect(written).toEqual(["another 3 MB paste"]);
    autosave.dispose();
  });

  it("counts each series of failed saves once", async () => {
    let fail = true;
    const autosave = createAutosave({
      initial: "",
      read: () => value,
      write: async () => {
        if (fail) throw new Error("nope");
      },
    });
    const before = saveFailureSeries();
    value = "a";
    autosave.touch();
    await expect(autosave.flush()).rejects.toThrow();
    await expect(autosave.flush()).rejects.toThrow();
    expect(saveFailureSeries()).toBe(before + 1);
    fail = false;
    await autosave.flush();
    fail = true;
    value = "b";
    autosave.touch();
    await expect(autosave.flush()).rejects.toThrow();
    expect(saveFailureSeries()).toBe(before + 2);
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
    let autosave!: Autosave<string>;
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
