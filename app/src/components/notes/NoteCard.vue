<script setup lang="ts">
// One note in the list (docs/08, docs/11): a card in the note's color.
import { CodeXml, Pin } from "lucide-vue-next";
import { noteRoute } from "../../composables/useNoteActions";
import type { NoteColor, NoteKind } from "../../types/note";
import { fullDate, shortRelativeDate } from "../../utils/relative-date";

defineProps<{
  id: string;
  title: string;
  color: NoteColor;
  kind: NoteKind;
  pinned: boolean;
  /** Date shown on the right (last change, or moment it went to the trash). */
  date: number;
  selected: boolean;
}>();
</script>

<template>
  <RouterLink
    :to="noteRoute(id)"
    :data-note-color="color"
    :aria-current="selected ? 'page' : undefined"
    class="note-card block rounded-card px-3 py-2.5 transition-colors duration-150 motion-reduce:transition-none"
    :class="selected ? 'bg-note-card-selected ring-2 ring-note-on-card' : 'bg-note-card'"
  >
    <span class="flex items-center gap-1.5">
      <Pin v-if="pinned" :size="14" class="shrink-0 text-note-on-card" aria-label="Épinglée" />
      <span class="flex-1 truncate font-semibold text-note-on-card">
        {{ title || "Nouvelle note" }}
      </span>
      <CodeXml
        v-if="kind === 'code'"
        :size="15"
        class="shrink-0 text-note-on-card"
        aria-label="Note code"
      />
    </span>
    <span class="mt-0.5 flex items-baseline gap-2 text-sm text-note-card-muted">
      <span class="min-w-0 flex-1 truncate"><slot /></span>
      <time class="shrink-0 text-xs" :datetime="new Date(date).toISOString()" :title="fullDate(date)">
        {{ shortRelativeDate(date) }}
      </time>
    </span>
  </RouterLink>
</template>
