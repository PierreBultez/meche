import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastsStore } from "./toasts";

describe("toasts", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the last three messages and hides each one after 5 s", async () => {
    const toasts = useToastsStore();
    ["a", "b", "c", "d"].forEach((message) => toasts.show(message));
    expect(toasts.toasts.map((toast) => toast.message)).toEqual(["b", "c", "d"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(toasts.toasts).toEqual([]);
  });

  it("keeps every message that has a button", () => {
    const toasts = useToastsStore();
    toasts.show("Note mise à la corbeille.", { tone: "info", action: { label: "Annuler", run: () => undefined } });
    toasts.show("Note mise à la corbeille.", { tone: "info", action: { label: "Annuler", run: () => undefined } });
    expect(toasts.toasts).toHaveLength(2);
  });

  it("replaces a message shown again instead of piling it up", () => {
    const toasts = useToastsStore();
    toasts.show("Enregistrement impossible.");
    toasts.show("Autre chose.");
    toasts.show("Enregistrement impossible.");
    expect(toasts.toasts.map((toast) => toast.message)).toEqual([
      "Autre chose.",
      "Enregistrement impossible.",
    ]);
  });
});
