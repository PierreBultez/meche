<script setup lang="ts">
// One note in the list (docs/08, docs/11): a card in the note's color.
// It is a plain link, not a RouterLink: with hundreds of cards, every RouterLink would be
// recomputed and redrawn each time another note is opened. Its texts are props, not a slot,
// so a card is only redrawn when its own note changes.
import { CodeXml, Pin } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { useUiStore } from "../../stores/ui";
import { noteRoute } from "../../composables/useNoteActions";
import type { NoteColor, NoteKind } from "../../types/note";
import { fullDate, shortRelativeDate } from "../../utils/relative-date";
import HighlightedText from "../ui/HighlightedText.vue";

const props = defineProps<{
  id: string;
  title: string;
  /** Preview, or search excerpt with match markers when `highlighted`. */
  preview: string;
  highlighted?: boolean;
  color: NoteColor;
  kind: NoteKind;
  pinned: boolean;
  /** Date shown on the right (last change, or moment it went to the trash). */
  date: number;
  selected: boolean;
}>();

const router = useRouter();
const ui = useUiStore();

function open(event: MouseEvent): void {
  // Entrée on a focused card (no mouse: detail is 0) carries on in the note's text.
  if (event.detail === 0) ui.editorFocusPending = true;
  void router.push(noteRoute(props.id));
}
</script>

<template>
  <a
    :href="`#${noteRoute(id)}`"
    :data-note-color="color"
    :aria-current="selected ? 'page' : undefined"
    class="note-card block rounded-card px-3 py-2.5 transition-colors duration-150 motion-reduce:transition-none"
    :class="selected ? 'bg-note-card-selected ring-2 ring-note-on-card' : 'bg-note-card'"
    @click.prevent="open"
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
      <span class="min-w-0 flex-1 truncate">
        <HighlightedText v-if="highlighted" :text="preview" />
        <template v-else>{{ preview }}</template>
      </span>
      <time class="shrink-0 text-xs" :datetime="new Date(date).toISOString()" :title="fullDate(date)">
        {{ shortRelativeDate(date) }}
      </time>
    </span>
  </a>
</template>
