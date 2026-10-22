<script setup lang="ts">
// « ⋯ » menu of a note (docs/08): color, conversion, copy as Markdown, line wrapping, trash.
import { ArrowLeftRight, Copy, MoreHorizontal, Trash2, WrapText } from "lucide-vue-next";
import { onBeforeUnmount, ref } from "vue";
import { NOTE_COLORS, NOTE_COLOR_LABELS } from "../../theme/note-colors";
import type { NoteColor, NoteKind } from "../../types/note";

const props = defineProps<{
  kind: NoteKind;
  color: NoteColor;
  wrap: boolean;
}>();
const emit = defineEmits<{
  color: [color: NoteColor];
  convert: [];
  copy: [];
  toggleWrap: [];
  trash: [];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

function closeOnOutsideClick(event: MouseEvent): void {
  if (open.value && !root.value?.contains(event.target as Node)) open.value = false;
}
document.addEventListener("mousedown", closeOnOutsideClick);
onBeforeUnmount(() => document.removeEventListener("mousedown", closeOnOutsideClick));

/** Closes the menu and gives the focus back to « ⋯ », where it came from. */
function close(): void {
  open.value = false;
  trigger.value?.focus();
}

// Échap closes an open menu; when it is closed, Échap goes on to the window (back to the list).
function onEscape(event: KeyboardEvent): void {
  if (!open.value) return;
  event.stopPropagation();
  close();
}

function run(action: () => void): void {
  close();
  action();
}

defineExpose({ toggle: () => (open.value = !open.value) });
</script>

<template>
  <div ref="root" class="relative" @keydown.escape="onEscape">
    <button
      ref="trigger"
      type="button"
      class="rounded-button p-2 text-muted hover:bg-surface-2 hover:text-text"
      aria-label="Plus d'actions"
      title="Plus d'actions"
      :aria-expanded="open"
      @click="open = !open"
    >
      <MoreHorizontal :size="18" aria-hidden="true" />
    </button>
    <div
      v-if="open"
      role="menu"
      class="absolute right-0 top-full z-30 mt-1 w-64 rounded-button border border-border bg-surface-2 p-1.5 text-sm text-text"
    >
      <p class="px-2 pb-1 pt-0.5 text-xs font-semibold text-muted">Couleur de la note</p>
      <div class="grid grid-cols-8 gap-1 px-1.5 pb-2" role="group" aria-label="Couleur de la note">
        <button
          v-for="choice in NOTE_COLORS"
          :key="choice"
          type="button"
          :data-note-color="choice"
          class="h-6 w-6 rounded-full bg-note"
          :class="choice === props.color ? 'ring-2 ring-text ring-offset-2 ring-offset-surface-2' : ''"
          :aria-label="NOTE_COLOR_LABELS[choice]"
          :title="NOTE_COLOR_LABELS[choice]"
          :aria-pressed="choice === props.color"
          @click="run(() => emit('color', choice))"
        />
      </div>
      <button type="button" role="menuitem" class="menu-item" @click="run(() => emit('convert'))">
        <ArrowLeftRight :size="16" aria-hidden="true" />
        {{ kind === "rich" ? "Convertir en note code" : "Convertir en note riche" }}
      </button>
      <button type="button" role="menuitem" class="menu-item" @click="run(() => emit('copy'))">
        <Copy :size="16" aria-hidden="true" />
        Copier en Markdown
      </button>
      <button
        v-if="kind === 'code'"
        type="button"
        role="menuitemcheckbox"
        class="menu-item"
        :aria-checked="wrap"
        @click="run(() => emit('toggleWrap'))"
      >
        <WrapText :size="16" aria-hidden="true" />
        <span class="flex-1">Retour à la ligne</span>
        <span class="text-xs text-muted">{{ wrap ? "activé" : "désactivé" }}</span>
      </button>
      <hr class="my-1 border-border" />
      <button
        type="button"
        role="menuitem"
        class="menu-item text-danger"
        @click="run(() => emit('trash'))"
      >
        <Trash2 :size="16" aria-hidden="true" />
        Mettre à la corbeille
      </button>
    </div>
  </div>
</template>
