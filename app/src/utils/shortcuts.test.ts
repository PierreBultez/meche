import { describe, expect, it } from "vitest";
import { shortcutFor } from "./shortcuts";

const press = (key: string, modifiers: Partial<KeyboardEventInit> = {}) =>
  shortcutFor(new KeyboardEvent("keydown", { key, ...modifiers }));

describe("keyboard shortcuts (docs/08)", () => {
  it.each([
    ["k", { ctrlKey: true }, "palette"],
    ["n", { ctrlKey: true }, "newNote"],
    ["N", { ctrlKey: true, shiftKey: true }, "newCodeNote"],
    ["f", { ctrlKey: true }, "search"],
    ["p", { ctrlKey: true }, "togglePin"],
    ["Delete", { ctrlKey: true }, "trash"],
    ["ArrowUp", { ctrlKey: true }, "previousNote"],
    ["ArrowDown", { ctrlKey: true }, "nextNote"],
    ["\\", { ctrlKey: true }, "toggleList"],
    ["F", { ctrlKey: true, shiftKey: true }, "focusMode"],
    ["E", { ctrlKey: true, shiftKey: true }, "toggleFuse"],
    ["Escape", {}, "escape"],
    ["k", { metaKey: true }, "palette"],
  ] as const)("%s %o → %s", (key, modifiers, action) => {
    expect(press(key, modifiers)).toBe(action);
  });

  it("ignores plain typing and unknown combinations", () => {
    expect(press("n")).toBeNull();
    expect(press("k", { altKey: true, ctrlKey: true })).toBeNull();
    expect(press("x", { ctrlKey: true })).toBeNull();
    expect(press("Escape", { shiftKey: true })).toBeNull();
  });
});
