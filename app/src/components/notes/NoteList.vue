<script setup lang="ts">
// Left column (docs/08): search, new note buttons, the list, filter and settings.
import { CodeXml, Plus, Search, Settings, Trash2, X } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useNoteActions } from "../../composables/useNoteActions";
import { useNotesStore } from "../../stores/notes";
import { useToastsStore } from "../../stores/toasts";
import { useUiStore } from "../../stores/ui";
import type { ListFilter, NoteColor, NoteKind } from "../../types/note";
import { scrollToShow, visibleRange } from "../../utils/virtual-list";
import ConfirmDialog from "../ui/ConfirmDialog.vue";
import UiSelect from "../ui/UiSelect.vue";
import NoteCard from "./NoteCard.vue";

const notes = useNotesStore();
const ui = useUiStore();
const toasts = useToastsStore();
const router = useRouter();
const actions = useNoteActions();

const searchInput = ref<HTMLInputElement | null>(null);
const listNav = ref<HTMLElement | null>(null);
const query = ref(notes.query);
const confirmingEmpty = ref(false);

const FILTERS: Array<{ value: ListFilter; label: string }> = [
  { value: "all", label: "Toutes" },
  { value: "pinned", label: "Épinglées" },
  { value: "ephemeral", label: "Mèches allumées" },
  { value: "trash", label: "Corbeille" },
];

const searching = computed(() => notes.results !== null);
const selectedId = computed(() => notes.current?.id ?? null);

interface Row {
  id: string;
  title: string;
  preview: string;
  highlighted: boolean;
  color: NoteColor;
  kind: NoteKind;
  pinned: boolean;
  date: number;
}

/** The cards of the list: search results while searching, otherwise the filtered notes. */
const rows = computed<Row[]>(() =>
  notes.results !== null
    ? notes.results.map((result) => ({
        ...result,
        preview: result.excerpt,
        highlighted: true,
        date: result.updatedAt,
      }))
    : notes.summaries.map((summary) => ({
        ...summary,
        highlighted: false,
        date: summary.trashedAt ?? summary.updatedAt,
      })),
);

// ── Virtual list: only the cards in view are in the page (docs/08), so opening a note or
// scrolling stays instant with thousands of notes. All cards have the same height. ──
const list = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(800);
const rowHeight = ref(74);
const range = computed(() =>
  visibleRange(scrollTop.value, viewportHeight.value, rowHeight.value, rows.value.length),
);
/** The card that has the keyboard focus stays drawn even when the list scrolls away from it:
 * removing it would drop the focus. */
const focusedId = ref<string | null>(null);
const visibleRows = computed(() => {
  const drawn = rows.value.slice(range.value.start, range.value.end).map((row, offset) => ({
    row,
    index: range.value.start + offset,
  }));
  const focused = focusedId.value === null ? -1 : rows.value.findIndex((row) => row.id === focusedId.value);
  // Kept at its place in the page order (before or after the others): moving the element
  // would drop the focus.
  const kept = { row: rows.value[focused], index: focused };
  if (focused !== -1 && focused < range.value.start) drawn.unshift(kept);
  if (focused !== -1 && focused >= range.value.end) drawn.push(kept);
  return drawn;
});

function onFocusIn(event: FocusEvent): void {
  const index = (event.target as HTMLElement).closest("li")?.dataset.index;
  focusedId.value = index === undefined ? null : (rows.value[Number(index)]?.id ?? null);
}

function onFocusOut(event: FocusEvent): void {
  if (!listNav.value?.contains(event.relatedTarget as Node | null)) focusedId.value = null;
}

function onScroll(): void {
  scrollTop.value = listNav.value?.scrollTop ?? 0;
}

// Also when the list is shown again (Ctrl+\, focus mode): its scroll position comes back without
// a scroll event.
const resizeObserver = new ResizeObserver(() => {
  viewportHeight.value = listNav.value?.clientHeight ?? viewportHeight.value;
  scrollTop.value = listNav.value?.scrollTop ?? scrollTop.value;
});
onMounted(() => {
  if (listNav.value) resizeObserver.observe(listNav.value);
});
onBeforeUnmount(() => resizeObserver.disconnect());

// The height of a card follows the font size, so it is measured. Every card has the same
// height (NoteCard fixes the height of its lines); the tallest one drawn is taken anyway, so
// that cards can never overlap.
watch(
  visibleRows,
  () => {
    const heights = [...(list.value?.querySelectorAll<HTMLElement>(":scope > li") ?? [])].map(
      (row) => row.offsetHeight,
    );
    const height = Math.max(0, ...heights);
    if (height > 0 && height !== rowHeight.value) rowHeight.value = height;
  },
  { flush: "post" },
);

/** Scrolls the list so that row `index` is in view, then waits for it to be drawn. */
async function showRow(index: number): Promise<void> {
  const nav = listNav.value;
  if (!nav) return;
  // Right after the list is shown again (Ctrl+\, focus mode), the observer has not reported its
  // height and scroll position yet: read them now, so that the right rows are drawn.
  viewportHeight.value = nav.clientHeight;
  scrollTop.value = nav.scrollTop;
  const listTop = list.value?.offsetTop ?? 0;
  const target = scrollToShow(index, nav.scrollTop - listTop, nav.clientHeight - listTop, rowHeight.value);
  if (target !== null) {
    nav.scrollTop = target + listTop;
    scrollTop.value = nav.scrollTop;
  }
  await nextTick();
}

function cardAt(index: number): HTMLElement | null {
  return list.value?.querySelector<HTMLElement>(`li[data-index="${index}"] a`) ?? null;
}

// A new list (search, filter): back to its top.
watch([() => notes.filter, searching, () => notes.query], () => {
  if (listNav.value) listNav.value.scrollTop = 0;
  scrollTop.value = 0;
});

// A newly opened note is brought into view (Ctrl+↑ / Ctrl+↓, palette). A new note only
// appears in the list after the next refresh, so it is looked for again then. The list is
// not moved on later refreshes: the user may be scrolling it while typing.
let toReveal: string | null = null;
function revealSelected(): void {
  const index = rows.value.findIndex((row) => row.id === toReveal);
  if (index === -1) return;
  toReveal = null;
  void showRow(index);
}
watch(selectedId, (id) => {
  toReveal = id;
  revealSelected();
});
watch(rows, () => {
  if (toReveal !== null) revealSelected();
});

/** Text of the empty state (docs/11, "Ton des textes"). */
const emptyText = computed(() => {
  if (searching.value) return "Aucune note ne correspond.";
  switch (notes.filter) {
    case "trash":
      return "Corbeille vide. Les notes y restent 7 jours.";
    case "pinned":
      return "Aucune note épinglée. Ctrl+P sur une note pour l'épingler.";
    case "ephemeral":
      return "Aucune mèche allumée.";
    default:
      return "Rien ici pour l'instant. Ctrl+N pour écrire.";
  }
});

function onSearch(): void {
  notes.search(query.value).catch((error: unknown) => toasts.error("La recherche a échoué.", error));
}

function clearSearch(): void {
  query.value = "";
  onSearch();
}

// The search can also be cleared from elsewhere (creating a note with Ctrl+N).
watch(
  () => notes.query,
  (text) => {
    if (text !== query.value) query.value = text;
  },
);

/** Shows the list (hidden with Ctrl+\ or by the focus mode), then focuses an element of it. */
async function reveal(): Promise<void> {
  ui.listHidden = false;
  ui.focusMode = false;
  await nextTick();
}

watch(
  () => ui.searchFocusRequest,
  async () => {
    await reveal();
    searchInput.value?.focus();
    searchInput.value?.select();
  },
);

// Échap in the open note: back to its card (or the first one), ready for ↑ ↓ and Entrée.
watch(
  () => ui.listFocusRequest,
  async () => {
    await reveal();
    if (rows.value.length === 0) {
      searchInput.value?.focus();
      return;
    }
    const index = Math.max(0, rows.value.findIndex((row) => row.id === selectedId.value));
    await showRow(index);
    cardAt(index)?.focus({ focusVisible: true });
  },
);

/** ↑ ↓ move between the cards of the list. */
async function moveFocus(event: KeyboardEvent, step: 1 | -1): Promise<void> {
  const current = (document.activeElement as HTMLElement | null)?.closest("li")?.dataset.index;
  if (current === undefined) return;
  event.preventDefault();
  const index = Math.min(Math.max(Number(current) + step, 0), rows.value.length - 1);
  await showRow(index);
  cardAt(index)?.focus({ focusVisible: true });
}

function createNote(kind: NoteKind): void {
  void actions.create(kind);
}

async function changeFilter(value: string): Promise<void> {
  await notes.setFilter(value as ListFilter).catch((error: unknown) => toasts.error("Impossible d'afficher ces notes.", error));
}

async function emptyTrash(): Promise<void> {
  confirmingEmpty.value = false;
  try {
    const count = await notes.clearTrash();
    toasts.show(count > 1 ? `${count} notes supprimées définitivement.` : "Note supprimée définitivement.");
    // Only the open note that was in the trash is gone: a note open elsewhere stays open.
    if (notes.current === null) await router.push("/notes");
  } catch (error) {
    toasts.error("Impossible de vider la corbeille.", error);
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-1.5 p-3 pb-2">
      <label class="relative min-w-0 flex-1">
        <span class="sr-only">Rechercher dans les notes</span>
        <Search
          :size="16"
          class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          placeholder="Rechercher…"
          class="w-full rounded-button bg-surface-2 py-2 pl-8 pr-7 text-sm text-text placeholder:text-muted"
          @input="onSearch"
          @keydown.escape="clearSearch"
        />
        <button
          v-if="query"
          type="button"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[6px] p-0.5 text-muted hover:text-text"
          aria-label="Effacer la recherche"
          @click="clearSearch"
        >
          <X :size="14" aria-hidden="true" />
        </button>
      </label>
      <button
        type="button"
        class="rounded-button bg-surface-2 p-2 text-text hover:ring-1 hover:ring-border"
        title="Nouvelle note code (Ctrl+Maj+N)"
        aria-label="Nouvelle note code"
        @click="createNote('code')"
      >
        <CodeXml :size="18" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="rounded-button bg-brand p-2 text-on-brand"
        title="Nouvelle note (Ctrl+N)"
        aria-label="Nouvelle note"
        @click="createNote('rich')"
      >
        <Plus :size="18" aria-hidden="true" />
      </button>
    </div>

    <nav
      ref="listNav"
      class="relative min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1"
      aria-label="Notes"
      @scroll.passive="onScroll"
      @focusin="onFocusIn"
      @focusout="onFocusOut"
      @keydown.down="moveFocus($event, 1)"
      @keydown.up="moveFocus($event, -1)"
    >
      <ul
        v-if="rows.length > 0"
        ref="list"
        class="relative"
        :style="{ height: `${rows.length * rowHeight}px` }"
      >
        <li
          v-for="{ row, index } in visibleRows"
          :key="row.id"
          :data-index="index"
          class="absolute inset-x-0 pb-2"
          :style="{ top: `${index * rowHeight}px` }"
          :aria-setsize="rows.length"
          :aria-posinset="index + 1"
        >
          <NoteCard
            :id="row.id"
            :title="row.title"
            :preview="row.preview"
            :highlighted="row.highlighted"
            :color="row.color"
            :kind="row.kind"
            :pinned="row.pinned"
            :date="row.date"
            :selected="row.id === selectedId"
          />
        </li>
      </ul>
      <p v-else class="px-2 py-8 text-center text-sm text-muted">{{ emptyText }}</p>
    </nav>

    <footer class="flex items-center gap-1.5 border-t border-border p-2">
      <UiSelect
        class="flex-1"
        label="Afficher"
        :model-value="notes.filter"
        :options="FILTERS"
        @update:model-value="changeFilter"
      />
      <button
        v-if="notes.filter === 'trash' && notes.summaries.length > 0"
        type="button"
        class="flex items-center gap-1 rounded-button px-2 py-1.5 text-sm font-semibold text-danger hover:bg-surface-2"
        @click="confirmingEmpty = true"
      >
        <Trash2 :size="15" aria-hidden="true" />
        Vider
      </button>
      <RouterLink
        to="/settings"
        class="rounded-button p-2 text-muted hover:bg-surface-2 hover:text-text"
        title="Réglages"
        aria-label="Réglages"
      >
        <Settings :size="18" aria-hidden="true" />
      </RouterLink>
    </footer>

    <ConfirmDialog
      :open="confirmingEmpty"
      title="Vider la corbeille ?"
      message="Les notes de la corbeille seront supprimées définitivement, sur tous tes appareils."
      confirm-label="Vider la corbeille"
      @confirm="emptyTrash"
      @cancel="confirmingEmpty = false"
    />
  </div>
</template>
