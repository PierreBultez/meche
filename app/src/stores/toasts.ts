import { defineStore } from "pinia";
import { ref } from "vue";

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
  /** Optional button, e.g. « Annuler ». */
  action?: { label: string; run: () => void | Promise<void> };
}

const DURATION_MS = 5000;

/** Short messages at the bottom of the window (« Note mise à la corbeille. Annuler »). */
export const useToastsStore = defineStore("toasts", () => {
  const toasts = ref<Toast[]>([]);
  let nextId = 1;

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function show(message: string, options: Omit<Toast, "id" | "message"> = { tone: "info" }): number {
    const id = nextId++;
    toasts.value = [...toasts.value.slice(-2), { id, message, ...options }];
    setTimeout(() => dismiss(id), DURATION_MS);
    return id;
  }

  /** Shows a French message for a failed action and logs the technical error. */
  function error(message: string, cause: unknown): void {
    console.error(message, cause);
    show(message, { tone: "error" });
  }

  return { toasts, show, error, dismiss };
});
