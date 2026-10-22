import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, resolveTheme, syncWindowBackground } from "./apply";

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

describe("syncWindowBackground", () => {
  afterEach(() => {
    clearMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  /** An element in the document (a detached one has no computed style) with a --bg value. */
  function themedRoot(): HTMLElement {
    const root = document.createElement("div");
    root.style.setProperty("--bg", "#1a1446");
    document.body.append(root);
    return root;
  }

  function recordIpcCalls() {
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    mockWindows("main");
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
    });
    return calls;
  }

  it("paints the native window with --bg inside the Tauri app", async () => {
    vi.stubGlobal("isTauri", true);
    const calls = recordIpcCalls();
    await syncWindowBackground(themedRoot());

    expect(calls).toContainEqual({
      cmd: "plugin:window|set_background_color",
      payload: { label: "main", value: "#1a1446" },
    });
  });

  it("does nothing outside the Tauri app", async () => {
    const calls = recordIpcCalls();
    await syncWindowBackground(themedRoot());

    expect(calls).toEqual([]);
  });
});
