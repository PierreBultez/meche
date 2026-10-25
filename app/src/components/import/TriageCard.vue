<script setup lang="ts">
// The note on top of the triage (docs/07, "Écran de tri"): a card in its color, with its title,
// its age and its content, read-only, folded to the first lines. On a touch screen, it is swiped
// right to keep the note, left to put it in the trash.
import { CodeXml } from "lucide-vue-next";
import { computed, defineAsyncComponent, nextTick, ref, watch } from "vue";
import { getNote } from "../../api/notes";
import type { TriageCard } from "../../import/types";
import { useSettingsStore } from "../../stores/settings";
import type { Note } from "../../types/note";
import { fullDate, longAgoText } from "../../utils/relative-date";

const props = defineProps<{ card: TriageCard }>();
const emit = defineEmits<{ swipe: [direction: "keep" | "trash"]; escape: [] }>();

// The editors are loaded with the first card, like in the note screen (docs/08).
const RichEditor = defineAsyncComponent(() => import("../editor/RichEditor.vue"));
const CodeEditor = defineAsyncComponent(() => import("../editor/CodeEditor.vue"));

const settings = useSettingsStore();
const note = ref<Note | null>(null);
const unreadable = ref(false);
const expanded = ref(false);
/** The folded content is cut: the « Afficher toute la note » button is useful. */
const overflowing = ref(false);
const body = ref<HTMLElement | null>(null);

watch(
  () => props.card.id,
  async (id) => {
    note.value = null;
    unreadable.value = false;
    expanded.value = false;
    overflowing.value = false;
    try {
      const loaded = await getNote(id);
      if (props.card.id === id) note.value = loaded;
    } catch (error) {
      console.error("could not read the note", error);
      if (props.card.id === id) unreadable.value = true;
    }
  },
  { immediate: true },
);

async function measure(): Promise<void> {
  await nextTick();
  const element = body.value;
  overflowing.value = element !== null && element.scrollHeight > element.clientHeight + 1;
}

// ── Swipe (touch screens and pens; with a mouse, text stays selectable) ──
const offset = ref(0);
let start: { x: number; pointer: number } | null = null;
const SWIPE_PX = 110;

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === "mouse" || (event.target as Element).closest("button")) return;
  start = { x: event.clientX, pointer: event.pointerId };
  // The card keeps receiving the finger's moves, even once it is outside the card.
  (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (start?.pointer === event.pointerId) offset.value = event.clientX - start.x;
}

function onPointerEnd(event: PointerEvent): void {
  if (start?.pointer !== event.pointerId) return;
  const moved = offset.value;
  start = null;
  offset.value = 0;
  if (Math.abs(moved) >= SWIPE_PX) emit("swipe", moved > 0 ? "keep" : "trash");
}

const transform = computed(() =>
  offset.value ? `translateX(${offset.value}px) rotate(${offset.value / 40}deg)` : undefined,
);
const swipeHint = computed(() => {
  if (Math.abs(offset.value) < SWIPE_PX / 2) return null;
  return offset.value > 0 ? "Garder" : "Supprimer";
});
</script>

<template>
  <article
    :data-note-color="card.color"
    class="note-card relative rounded-card bg-note-card p-4 touch-pan-y select-text"
    :class="offset ? '' : 'transition-transform duration-150 motion-reduce:transition-none'"
    :style="{ transform }"
    aria-roledescription="carte de tri"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
  >
    <header class="flex items-start gap-2">
      <h2 class="min-w-0 flex-1 text-xl font-semibold break-words text-note-on-card">
        {{ card.title || "Sans titre" }}
      </h2>
      <CodeXml v-if="card.kind === 'code'" :size="18" class="mt-1 shrink-0 text-note-on-card" aria-label="Note code" />
    </header>
    <p class="mt-1 text-sm text-note-card-muted">
      Modifiée
      <time :datetime="new Date(card.updatedAt).toISOString()" :title="fullDate(card.updatedAt)">
        {{ longAgoText(card.updatedAt) }}
      </time>
    </p>

    <div
      ref="body"
      class="mt-3 overflow-hidden rounded-button bg-bg text-text"
      :class="expanded ? '' : 'max-h-72'"
    >
      <p v-if="unreadable" class="p-4 text-muted">Impossible d'afficher cette note.</p>
      <div v-else-if="note && note.content.trim() === ''" class="p-4 text-muted">Note vide.</div>
      <template v-else-if="note">
        <div v-if="note.kind === 'rich'" class="triage-preview px-4">
          <RichEditor :key="note.id" :content="note.content" :editable="false" @ready="measure" @escape="emit('escape')" />
        </div>
        <CodeEditor
          v-else
          :key="note.id"
          :content="note.content"
          :language="note.codeLanguage"
          :wrap="settings.codeLineWrap"
          :editable="false"
          @ready="measure"
        />
      </template>
    </div>
    <button
      v-if="overflowing || expanded"
      type="button"
      class="mt-2 rounded-button px-2 py-1 text-sm font-semibold text-note-on-card hover:bg-bg"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? "Replier" : "Afficher toute la note" }}
    </button>

    <p
      v-if="swipeHint"
      class="absolute top-3 rounded-full bg-bg px-3 py-1 font-semibold"
      :class="swipeHint === 'Garder' ? 'left-3 text-ok' : 'right-3 text-danger'"
      aria-hidden="true"
    >
      {{ swipeHint }}
    </p>
  </article>
</template>
