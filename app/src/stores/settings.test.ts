import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Settings } from "../types/settings";
import { useSettingsStore } from "./settings";

/** Fake `prefers-color-scheme` that the tests can flip. */
function mockSystemTheme(initiallyDark: boolean) {
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  const query = {
    matches: initiallyDark,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
      listeners.push(listener),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    switchTo(dark: boolean) {
      query.matches = dark;
      listeners.forEach((listener) => listener({ matches: dark }));
    },
  };
}

/** Fake Rust core: an in-memory settings table. */
function mockRustCore(saved: Settings, options: { failWrites?: boolean } = {}) {
  const calls: Array<{ cmd: string; payload: unknown }> = [];
  mockIPC((cmd, payload) => {
    calls.push({ cmd, payload });
    if (cmd === "get_settings") {
      return saved;
    }
    if (cmd === "set_settings") {
      if (options.failWrites) {
        throw new Error("disk full");
      }
      Object.assign(saved, (payload as { patch: Partial<Settings> }).patch);
      return saved;
    }
    throw new Error(`unexpected command ${cmd}`);
  });
  return calls;
}

const currentTheme = () => document.documentElement.dataset.theme;

describe("settings store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    clearMocks();
    vi.unstubAllGlobals();
  });

  it("applies the system theme as soon as it is created", () => {
    mockSystemTheme(true);
    mockRustCore({ theme: "system" });
    useSettingsStore();
    expect(currentTheme()).toBe("dark");
  });

  it("applies the saved theme once loaded", async () => {
    mockSystemTheme(true);
    mockRustCore({ theme: "light" });
    const store = useSettingsStore();
    await store.load();
    await nextTick();
    expect(store.theme).toBe("light");
    expect(currentTheme()).toBe("light");
  });

  it("switches at once and saves the new theme in Rust", async () => {
    mockSystemTheme(false);
    const calls = mockRustCore({ theme: "system" });
    const store = useSettingsStore();
    const saving = store.setTheme("dark");
    await nextTick();
    expect(currentTheme()).toBe("dark"); // before the save has completed
    await saving;
    expect(calls).toContainEqual({ cmd: "set_settings", payload: { patch: { theme: "dark" } } });
  });

  it("rolls back when saving fails", async () => {
    mockSystemTheme(false);
    mockRustCore({ theme: "light" }, { failWrites: true });
    const store = useSettingsStore();
    await store.load();
    await expect(store.setTheme("dark")).rejects.toThrow();
    await nextTick();
    expect(store.theme).toBe("light");
    expect(currentTheme()).toBe("light");
  });

  it("follows system changes only in system mode", async () => {
    const system = mockSystemTheme(false);
    mockRustCore({ theme: "system" });
    const store = useSettingsStore();
    system.switchTo(true);
    await nextTick();
    expect(currentTheme()).toBe("dark");

    await store.setTheme("light");
    system.switchTo(false);
    system.switchTo(true);
    await nextTick();
    expect(currentTheme()).toBe("light");
  });
});
