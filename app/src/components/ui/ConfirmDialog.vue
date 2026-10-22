<script setup lang="ts">
// Confirmation before an action that cannot be undone (docs/06: emptying the trash).
import { ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) dialog.value?.showModal();
    else dialog.value?.close();
  },
);
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-[min(26rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-5 text-text backdrop:bg-bg/70"
    @cancel.prevent="emit('cancel')"
  >
    <h2 class="text-lg font-semibold">{{ title }}</h2>
    <p class="mt-2 text-muted">{{ message }}</p>
    <div class="mt-5 flex justify-end gap-2">
      <button
        type="button"
        class="rounded-button bg-surface-2 px-3 py-1.5 font-semibold text-text"
        @click="emit('cancel')"
      >
        Annuler
      </button>
      <button
        type="button"
        class="rounded-button border border-danger bg-surface-2 px-3 py-1.5 font-semibold text-danger"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
    </div>
  </dialog>
</template>
