<script setup lang="ts">
// Left column (docs/08): search, new note buttons, the list, filter and settings.
import { CodeXml, Plus, Search, Settings, Trash2, X } from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useNoteActions } from "../../composables/useNoteActions";
import { useNotesStore } from "../../stores/notes";
import { useToastsStore } from "../../stores/toasts";
import { useUiStore } from "../../stores/ui";
import type { ListFilter, NoteKind } from "../../types/note";
import ConfirmDialog from "../ui/ConfirmDialog.vue";
import HighlightedText from "../ui/HighlightedText.vue";
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
    const cards = listNav.value?.querySelectorAll<HTMLElement>("a") ?? [];
    const selected = listNav.value?.querySelector<HTMLElement>('a[aria-current="page"]');
    (selected ?? cards[0] ?? searchInput.value)?.focus({ focusVisible: true });
  },
);

/** ↑ ↓ move between the cards of the list. */
function moveFocus(event: KeyboardEvent, step: 1 | -1): void {
  const cards = [...(listNav.value?.querySelectorAll<HTMLElement>("a") ?? [])];
  const index = cards.indexOf(document.activeElement as HTMLElement);
  if (index === -1) return;
  event.preventDefault();
  cards[Math.min(Math.max(index + step, 0), cards.length - 1)].focus({ focusVisible: true });
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
    await router.push("/notes");
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
      class="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1"
      aria-label="Notes"
      @keydown.down="moveFocus($event, 1)"
      @keydown.up="moveFocus($event, -1)"
    >
      <ul v-if="searching && notes.results!.length > 0" class="space-y-2">
        <li v-for="result in notes.results" :key="result.id">
          <NoteCard
            :id="result.id"
            :title="result.title"
            :color="result.color"
            :kind="result.kind"
            :pinned="result.pinned"
            :date="result.updatedAt"
            :selected="result.id === selectedId"
          >
            <HighlightedText :text="result.excerpt" />
          </NoteCard>
        </li>
      </ul>
      <ul v-else-if="!searching && notes.summaries.length > 0" class="space-y-2">
        <li v-for="summary in notes.summaries" :key="summary.id">
          <NoteCard
            :id="summary.id"
            :title="summary.title"
            :color="summary.color"
            :kind="summary.kind"
            :pinned="summary.pinned"
            :date="summary.trashedAt ?? summary.updatedAt"
            :selected="summary.id === selectedId"
          >
            {{ summary.preview }}
          </NoteCard>
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
