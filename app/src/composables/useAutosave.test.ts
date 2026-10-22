import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, flushAllAutosaves } from "./useAutosave";

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
    await autosave.flush();
    await autosave.flush();
    expect(written).toEqual(["x"]);
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

  it("reports write errors without blocking later saves", async () => {
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
    await autosave.flush();
    expect(errors).toHaveLength(1);
    fail = false;
    await autosave.flush(); // same value: retried because the first write failed
    expect(written).toEqual(["a"]);
    value = "b";
    await autosave.flush();
    expect(written).toEqual(["a", "b"]);
    autosave.dispose();
  });
});
