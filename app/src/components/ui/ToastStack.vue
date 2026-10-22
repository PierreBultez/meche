<script setup lang="ts">
import { X } from "lucide-vue-next";
import { useToastsStore } from "../../stores/toasts";

const toasts = useToastsStore();

async function act(id: number, run: () => void | Promise<void>): Promise<void> {
  toasts.dismiss(id);
  await run();
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    aria-live="polite"
  >
    <div
      v-for="toast in toasts.toasts"
      :key="toast.id"
      :role="toast.tone === 'error' ? 'alert' : 'status'"
      class="pointer-events-auto flex max-w-md items-center gap-3 rounded-button border border-border bg-surface-2 py-2 pl-4 pr-2 text-sm"
      :class="toast.tone === 'error' ? 'text-danger' : 'text-text'"
    >
      <span class="flex-1">{{ toast.message }}</span>
      <button
        v-if="toast.action"
        type="button"
        class="rounded-[8px] px-2 py-1 font-semibold text-brand hover:bg-surface"
        @click="act(toast.id, toast.action.run)"
      >
        {{ toast.action.label }}
      </button>
      <button
        type="button"
        class="rounded-[8px] p-1 text-muted hover:text-text"
        aria-label="Fermer"
        @click="toasts.dismiss(toast.id)"
      >
        <X :size="14" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
