<script setup lang="ts">
// The triage after an import (docs/07, "Écran de tri"): one note at a time, the oldest first.
// Garder (G or →), Mèche (E), Supprimer (S or ←), Passer (Espace), Annuler (Ctrl+Z). Leaving
// keeps the progress: Rust remembers which notes are still waiting.
import { ArrowLeft, Check, SkipForward, Trash2, Undo2 } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import FuseIcon from "../components/fuse/FuseIcon.vue";
import TriageCard from "../components/import/TriageCard.vue";
import { noteRoute } from "../composables/useNoteActions";
import type { CommandError } from "../types/note";
import type { TriageDecision } from "../import/types";
import { useImportStore } from "../stores/import";
import { useNotesStore } from "../stores/notes";
import { useSettingsStore } from "../stores/settings";
import { useToastsStore } from "../stores/toasts";
import { useUiStore } from "../stores/ui";
import { fuseDelayLabel } from "../utils/fuse";

const store = useImportStore();
const notes = useNotesStore();
const settings = useSettingsStore();
const toasts = useToastsStore();
const ui = useUiStore();
const router = useRouter();

const loaded = ref(false);
/** A decision is on its way: the next one waits (a key held down must not decide twice). */
const busy = ref(false);
const stage = ref<HTMLElement | null>(null);

const triage = computed(() => store.triage);
const card = computed(() => triage.value?.cards[0] ?? null);
const decided = computed(() => {
  const counts = triage.value?.counts;
  return counts ? counts.kept + counts.fused + counts.trashed : 0;
});
const total = computed(() => triage.value?.total ?? 0);
const percent = computed(() => (total.value ? Math.round((decided.value / total.value) * 100) : 0));

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const finalText = computed(() => {
  const counts = triage.value?.counts;
  if (!counts) return "";
  return [
    plural(counts.kept, "gardée", "gardées"),
    plural(counts.fused, "mèche allumée", "mèches allumées"),
    `${counts.trashed} à la corbeille`,
  ].join(", ");
});

onMounted(async () => {
  window.addEventListener("keydown", onKeyDown);
  try {
    await store.loadTriage();
  } catch (error) {
    toasts.error("Impossible de charger le tri.", error);
  }
  loaded.value = true;
  await nextTick();
  stage.value?.focus();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown));

async function decide(decision: TriageDecision): Promise<void> {
  if (busy.value || !card.value) return;
  busy.value = true;
  try {
    await store.decide(decision);
  } catch (error) {
    toasts.error("Impossible d'appliquer ce choix à la note.", error);
  } finally {
    busy.value = false;
  }
  // The buttons may have had the focus: the shortcuts keep working on the next card.
  stage.value?.focus();
}

async function undo(): Promise<void> {
  if (busy.value || store.history.length === 0) return;
  busy.value = true;
  try {
    await store.undo();
  } catch (error) {
    const changed = (error as CommandError | undefined)?.kind === "invalid_input";
    toasts.error(
      changed ? "Impossible d'annuler : la note a changé entre-temps." : "Impossible d'annuler ce choix.",
      error,
    );
  } finally {
    busy.value = false;
  }
  stage.value?.focus();
}

async function leave(): Promise<void> {
  await router.push(notes.current ? noteRoute(notes.current.id) : "/notes");
}

async function finish(): Promise<void> {
  try {
    await store.finish();
  } catch (error) {
    toasts.error("Impossible de terminer le tri.", error);
    return;
  }
  await router.push("/notes");
}

/** A typing field has the focus: its keys are its own. */
function inField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || ui.paletteOpen || inField(event.target)) return;
  if (event.target instanceof Element && event.target.closest("dialog")) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    void undo();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // Space and Enter on a focused button press it, as everywhere.
  const onButton = event.target instanceof Element && event.target.closest("button, a") !== null;
  const decisions: Record<string, TriageDecision> = {
    g: "keep",
    arrowright: "keep",
    e: "fuse",
    s: "trash",
    arrowleft: "trash",
  };
  const key = event.key.toLowerCase();
  // Maj+← and Maj+→ select text in the preview: not a decision.
  if (event.shiftKey && key.startsWith("arrow")) return;
  let decision: TriageDecision | undefined = Object.hasOwn(decisions, key) ? decisions[key] : undefined;
  if (key === " " && !onButton) decision = "skip";
  if (!decision || !card.value) return;
  event.preventDefault();
  if (!event.repeat) void decide(decision);
}
</script>

<template>
  <main class="h-screen overflow-y-auto bg-bg text-text">
    <div class="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header class="flex items-center gap-3">
        <button
          type="button"
          class="rounded-button p-2 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Quitter le tri"
          title="Quitter le tri (Échap) : la progression est gardée"
          @click="leave"
        >
          <ArrowLeft :size="20" aria-hidden="true" />
        </button>
        <h1 class="flex-1 text-2xl font-semibold">Tri des notes importées</h1>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-button px-3 py-1.5 font-semibold text-text hover:bg-surface-2 disabled:opacity-50"
          :disabled="store.history.length === 0 || busy"
          title="Annuler le dernier choix (Ctrl+Z)"
          @click="undo"
        >
          <Undo2 :size="18" aria-hidden="true" />
          Annuler
        </button>
      </header>

      <div v-if="total > 0" class="space-y-1.5">
        <p class="text-sm text-muted" aria-live="polite">{{ decided }} / {{ total }}</p>
        <div
          class="h-2 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          :aria-valuenow="decided"
          aria-valuemin="0"
          :aria-valuemax="total"
          aria-label="Notes triées"
        >
          <div class="h-full rounded-full bg-brand transition-[width] duration-150 motion-reduce:transition-none" :style="{ width: `${percent}%` }" />
        </div>
      </div>

      <!-- The stage takes the focus, so that the shortcuts work from the start. -->
      <section ref="stage" tabindex="-1" class="space-y-4 outline-none" aria-label="Note à trier">
        <template v-if="card">
          <TriageCard :card="card" @swipe="decide" @escape="leave" />
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-surface-2 px-3 py-2 font-semibold text-text hover:ring-1 hover:ring-border disabled:opacity-60"
              :disabled="busy"
              title="Garder la note telle quelle (G ou →)"
              @click="decide('keep')"
            >
              <Check :size="18" class="text-ok" aria-hidden="true" />
              Garder
              <kbd class="hidden text-xs font-normal text-muted sm:inline">G</kbd>
            </button>
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-surface-2 px-3 py-2 font-semibold text-text hover:ring-1 hover:ring-border disabled:opacity-60"
              :disabled="busy"
              :title="`Allumer la mèche : la note explosera dans ${fuseDelayLabel(settings.fuseDelayHours)} (E)`"
              @click="decide('fuse')"
            >
              <FuseIcon lit :size="18" />
              Mèche
              <kbd class="hidden text-xs font-normal text-muted sm:inline">E</kbd>
            </button>
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-surface-2 px-3 py-2 font-semibold text-danger hover:ring-1 hover:ring-border disabled:opacity-60"
              :disabled="busy"
              title="Mettre à la corbeille, récupérable 7 jours (S ou ←)"
              @click="decide('trash')"
            >
              <Trash2 :size="18" aria-hidden="true" />
              Supprimer
              <kbd class="hidden text-xs font-normal text-muted sm:inline">S</kbd>
            </button>
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-surface-2 px-3 py-2 font-semibold text-text hover:ring-1 hover:ring-border disabled:opacity-60"
              :disabled="busy"
              title="Revoir cette note à la fin (Espace)"
              @click="decide('skip')"
            >
              <SkipForward :size="18" class="text-muted" aria-hidden="true" />
              Passer
              <kbd class="hidden text-xs font-normal text-muted sm:inline">Espace</kbd>
            </button>
          </div>
        </template>

        <div v-else-if="loaded && total > 0" class="space-y-3 rounded-card bg-surface p-6 text-center" aria-live="polite">
          <p class="text-2xl font-semibold">C'est trié !</p>
          <p class="text-muted">{{ finalText }}.</p>
          <button type="button" class="rounded-button bg-brand px-4 py-2 font-semibold text-on-brand" @click="finish">
            Voir mes notes
          </button>
        </div>

        <div v-else-if="loaded" class="space-y-3 rounded-card bg-surface p-6 text-center">
          <p class="font-semibold">Aucune note à trier.</p>
          <p class="text-sm text-muted">Les notes importées depuis Standard Notes arrivent ici, les plus anciennes d'abord.</p>
          <RouterLink to="/import" class="inline-block rounded-button bg-brand px-4 py-2 font-semibold text-on-brand">
            Importer depuis Standard Notes
          </RouterLink>
        </div>
      </section>
    </div>
  </main>
</template>
