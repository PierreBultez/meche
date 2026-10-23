<script setup lang="ts">
// Main screen on desktop (docs/08): resizable note list on the left, open note on the right.
import { computed, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import NoteEditor from "../components/notes/NoteEditor.vue";
import NoteList from "../components/notes/NoteList.vue";
import { useNoteActions } from "../composables/useNoteActions";
import { useNotesStore } from "../stores/notes";
import { useSettingsStore } from "../stores/settings";
import { useToastsStore } from "../stores/toasts";
import { useUiStore } from "../stores/ui";

const MIN_WIDTH = 220;
const MAX_WIDTH = 520;

const route = useRoute();
const router = useRouter();
const notes = useNotesStore();
const settings = useSettingsStore();
const toasts = useToastsStore();
const ui = useUiStore();
const actions = useNoteActions();

const editor = ref<InstanceType<typeof NoteEditor> | null>(null);
const noteId = computed(() => (route.params.noteId as string | undefined) || null);
const listVisible = computed(() => !ui.listHidden && !ui.focusMode);

onMounted(() => {
  notes.refresh().catch((error: unknown) => toasts.error("Impossible de charger les notes.", error));
  // Warm up the rich editor while the user looks at the list, so the first note opens at once.
  setTimeout(() => void import("../components/editor/RichEditor.vue"), 300);
});

// Leaving the open note (another note, the settings) waits for its text to be saved, and is
// cancelled if it cannot be: the editor, and what was typed, stay on screen (docs/05).
onBeforeRouteUpdate(() => actions.saveOpenNote());
onBeforeRouteLeave(() => actions.saveOpenNote());

watch(
  noteId,
  (id) => {
    notes.open(id).catch(async (error: unknown) => {
      toasts.error("Cette note est introuvable.", error);
      await router.replace("/notes");
    });
  },
  { immediate: true },
);

// ── Resizable list column: dragged with the mouse, or with ← → when the handle has focus ──
const width = ref(settings.listWidth);
watch(
  () => settings.listWidth,
  (saved) => (width.value = saved),
);

const clamp = (value: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)));

function saveWidth(): void {
  settings
    .setListWidth(width.value)
    .catch((error: unknown) => toasts.error("Impossible d'enregistrer la largeur.", error));
}

function startResize(event: PointerEvent): void {
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startWidth = width.value;
  const move = (moveEvent: PointerEvent) => {
    width.value = clamp(startWidth + moveEvent.clientX - startX);
  };
  const stop = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", stop);
    saveWidth();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", stop);
}

function resizeWithKeys(event: KeyboardEvent): void {
  const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
  if (step === 0) return;
  event.preventDefault();
  width.value = clamp(width.value + step);
  saveWidth();
}

defineExpose({ editor });
</script>

<template>
  <div class="flex h-screen bg-bg text-text">
    <aside
      v-show="listVisible"
      class="h-full shrink-0 bg-surface"
      :style="{ width: `${width}px` }"
      aria-label="Liste des notes"
    >
      <NoteList />
    </aside>
    <div
      v-show="listVisible"
      role="separator"
      aria-orientation="vertical"
      aria-label="Largeur de la liste"
      :aria-valuenow="width"
      :aria-valuemin="MIN_WIDTH"
      :aria-valuemax="MAX_WIDTH"
      tabindex="0"
      class="group relative w-1.5 shrink-0 cursor-col-resize touch-none"
      @pointerdown="startResize"
      @keydown="resizeWithKeys"
    >
      <span
        class="absolute inset-y-0 left-0 w-px bg-border group-hover:w-0.5 group-hover:bg-brand group-focus-visible:w-0.5 group-focus-visible:bg-brand"
      />
    </div>
    <main class="h-full min-w-0 flex-1" data-note-pane>
      <NoteEditor
        v-if="notes.current"
        :key="`${notes.current.id}:${notes.current.kind}:${notes.editorGeneration}`"
        ref="editor"
        :note="notes.current"
      />
      <div v-else class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p class="text-4xl font-semibold text-brand">mèche</p>
        <p class="text-muted">Choisis une note, ou Ctrl+N pour en écrire une.</p>
      </div>
    </main>
  </div>
</template>
