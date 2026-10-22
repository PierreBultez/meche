import { describe, expect, it } from "vitest";
import { applyTheme, resolveTheme } from "./apply";

describe("resolveTheme", () => {
  it("follows the system in system mode", () => {
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("system", "light")).toBe("light");
  });

  it("ignores the system when a theme is chosen", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("sets data-theme on the root element", () => {
    const root = document.createElement("html");
    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
  });
});
