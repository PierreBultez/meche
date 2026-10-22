<script setup lang="ts">
// Command palette, Ctrl+K (docs/08): fuzzy search on the actions, full-text search on the notes.
import { CodeXml, FileText, Search } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { searchNotes } from "../api/notes";
import { useNoteActions } from "../composables/useNoteActions";
import { type PaletteAction, usePaletteActions } from "../composables/usePaletteActions";
import { useNotesStore } from "../stores/notes";
import { useToastsStore } from "../stores/toasts";
import { useUiStore } from "../stores/ui";
import type { NoteColor, NoteKind, SearchResult } from "../types/note";
import { rankByQuery } from "../utils/fuzzy";
import HighlightedText from "./ui/HighlightedText.vue";

const RECENT_NOTES = 5;
const MAX_NOTES = 8;
const MAX_WEAK_ACTIONS = 5;

interface Item {
  key: string;
  label: string;
  /** Excerpt with match markers, or note preview. */
  detail?: string;
  shortcut?: string;
  icon?: PaletteAction["icon"];
  color?: NoteColor;
  kind?: NoteKind;
  run: () => unknown;
}

const ui = useUiStore();
const notes = useNotesStore();
const toasts = useToastsStore();
const noteActions = useNoteActions();
const paletteActions = usePaletteActions();

const dialog = ref<HTMLDialogElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
const query = ref("");
const found = ref<SearchResult[]>([]);
const active = ref(0);
let searchRequest = 0;

watch(
  () => ui.paletteOpen,
  async (open) => {
    if (!open) {
      dialog.value?.close();
      return;
    }
    query.value = "";
    found.value = [];
    active.value = 0;
    dialog.value?.showModal();
    await nextTick();
    input.value?.focus();
  },
);

// Without its dialog (component replaced while developing), the palette is closed.
onBeforeUnmount(() => (ui.paletteOpen = false));

// Full-text search on the notes while typing. Answers to an older query are dropped.
watch(query, async (text) => {
  active.value = 0;
  const request = ++searchRequest;
  if (text.trim() === "") {
    found.value = [];
    return;
  }
  try {
    const results = await searchNotes(text);
    if (request === searchRequest) found.value = results.slice(0, MAX_NOTES);
  } catch (error) {
    toasts.error("La recherche a échoué.", error);
  }
});

const noteItem = (note: {
  id: string;
  title: string;
  color: NoteColor;
  kind: NoteKind;
  detail: string;
}): Item => ({
  key: `note:${note.id}`,
  label: note.title || "Nouvelle note",
  detail: note.detail,
  color: note.color,
  kind: note.kind,
  run: () => noteActions.open(note.id),
});

const actionItem = (action: PaletteAction): Item => ({ key: `action:${action.id}`, ...action });

/** Sections shown, in order: actions matching at word starts, then notes. */
const sections = computed(() => {
  const text = query.value;
  const { strong, weak } = rankByQuery(
    text,
    paletteActions.value,
    (action) => `${action.label} ${action.keywords ?? ""}`,
  );
  const noteItems =
    text.trim() === ""
      ? notes.summaries
          .slice(0, RECENT_NOTES)
          .map((summary) => noteItem({ ...summary, detail: summary.preview }))
      : found.value.map((result) => noteItem({ ...result, detail: result.excerpt }));
  const result: Array<{ title: string; items: Item[] }> = [];
  if (text.trim() === "") {
    result.push({ title: "Notes récentes", items: noteItems });
    result.push({ title: "Actions", items: strong.map(actionItem) });
  } else {
    result.push({ title: "Actions", items: strong.map(actionItem) });
    result.push({ title: "Notes", items: noteItems });
    // Loose matches (« nvnote ») only when nothing better was found: they would be noise.
    if (strong.length === 0 && noteItems.length === 0) {
      result.push({ title: "Actions", items: weak.slice(0, MAX_WEAK_ACTIONS).map(actionItem) });
    }
  }
  return result.filter((section) => section.items.length > 0);
});

const items = computed(() => sections.value.flatMap((section) => section.items));
const optionId = (index: number) => `palette-option-${index}`;
const indexOf = (item: Item) => items.value.indexOf(item);

function move(step: 1 | -1): void {
  const count = items.value.length;
  if (count === 0) return;
  active.value = (active.value + step + count) % count;
  void nextTick(() =>
    list.value?.querySelector(`#${optionId(active.value)}`)?.scrollIntoView({ block: "nearest" }),
  );
}

async function run(item: Item | undefined): Promise<void> {
  if (!item) return;
  close();
  await nextTick();
  await item.run();
}

function close(): void {
  ui.paletteOpen = false;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") move(1);
  else if (event.key === "ArrowUp") move(-1);
  else if (event.key === "Enter") void run(items.value[active.value]);
  else return;
  event.preventDefault();
}
</script>

<template>
  <dialog
    ref="dialog"
    data-command-palette
    aria-label="Palette de commandes"
    class="mx-auto mt-[12vh] w-[min(36rem,calc(100%-2rem))] overflow-hidden rounded-card border border-border bg-surface p-0 text-text backdrop:bg-bg/70"
    @cancel.prevent="close"
    @close="close"
    @click.self="close"
  >
    <div class="flex items-center gap-2 border-b border-border px-3">
      <Search :size="18" class="shrink-0 text-muted" aria-hidden="true" />
      <input
        ref="input"
        v-model="query"
        type="text"
        role="combobox"
        aria-label="Rechercher une note ou une action"
        aria-autocomplete="list"
        aria-controls="palette-options"
        :aria-expanded="items.length > 0"
        :aria-activedescendant="items.length > 0 ? optionId(active) : undefined"
        placeholder="Rechercher une note ou une action…"
        class="min-w-0 flex-1 bg-transparent py-3 text-text placeholder:text-muted focus-visible:outline-none"
        @keydown="onKeyDown"
      />
      <kbd class="shrink-0 rounded-[6px] bg-surface-2 px-1.5 py-0.5 font-sans text-xs text-muted">
        Échap
      </kbd>
    </div>

    <div ref="list" class="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
      <ul id="palette-options" role="listbox" aria-label="Résultats">
        <template v-for="section in sections" :key="section.title">
          <li role="presentation" class="px-2 pb-1 pt-2 text-xs font-semibold text-muted">
            {{ section.title }}
          </li>
          <li
            v-for="item in section.items"
            :id="optionId(indexOf(item))"
            :key="item.key"
            role="option"
            :aria-selected="indexOf(item) === active"
            class="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5"
            :class="indexOf(item) === active ? 'bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]' : ''"
            @mousemove="active = indexOf(item)"
            @click="run(item)"
          >
            <template v-if="item.kind">
              <span
                :data-note-color="item.color"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-note-card text-note-on-card"
                aria-hidden="true"
              >
                <CodeXml v-if="item.kind === 'code'" :size="14" />
                <FileText v-else :size="14" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">{{ item.label }}</span>
                <span v-if="item.detail" class="block truncate text-sm text-muted">
                  <HighlightedText :text="item.detail" />
                </span>
              </span>
            </template>
            <template v-else>
              <span class="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
                <span v-if="item.color" :data-note-color="item.color" class="h-4 w-4 rounded-full bg-note" />
                <component :is="item.icon" v-else-if="item.icon" :size="17" class="text-muted" />
              </span>
              <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              <kbd v-if="item.shortcut" class="shrink-0 font-sans text-xs text-muted">
                {{ item.shortcut }}
              </kbd>
            </template>
          </li>
        </template>
      </ul>
      <p v-if="items.length === 0" class="px-2 py-6 text-center text-sm text-muted">
        Aucune note ni action ne correspond.
      </p>
    </div>
  </dialog>
</template>
