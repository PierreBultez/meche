<script setup lang="ts">
// Settings (docs/08, "Écrans secondaires"): appearance, the fuse, code notes.
import { getVersion } from "@tauri-apps/api/app";
import { ArrowLeft } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import ThemeSwitcher from "../components/ThemeSwitcher.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import { noteRoute } from "../composables/useNoteActions";
import { useNotesStore } from "../stores/notes";
import { useSettingsStore } from "../stores/settings";
import { useToastsStore } from "../stores/toasts";
import { FUSE_DELAYS } from "../utils/fuse";

const settings = useSettingsStore();
const notes = useNotesStore();
const toasts = useToastsStore();
const version = ref("");

onMounted(async () => {
  version.value = await getVersion().catch(() => "");
});

const delayOptions = FUSE_DELAYS.map(({ hours, label }) => ({ value: String(hours), label }));

function setFuseDelay(value: string): void {
  settings
    .setFuseDelayHours(Number(value))
    .catch((error: unknown) => toasts.error("Impossible d'enregistrer ce réglage.", error));
}

function toggleWrap(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  settings
    .setCodeLineWrap(checked)
    .catch((error: unknown) => toasts.error("Impossible d'enregistrer ce réglage.", error));
}
</script>

<template>
  <main class="h-screen overflow-y-auto bg-bg text-text">
    <div class="mx-auto max-w-2xl space-y-8 px-6 py-8">
      <header class="flex items-center gap-3">
        <RouterLink
          :to="notes.current ? noteRoute(notes.current.id) : '/notes'"
          class="rounded-button p-2 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Retour aux notes"
          title="Retour aux notes (Échap)"
        >
          <ArrowLeft :size="20" aria-hidden="true" />
        </RouterLink>
        <h1 class="text-2xl font-semibold">Réglages</h1>
      </header>

      <section class="space-y-3" aria-labelledby="appearance">
        <h2 id="appearance" class="text-sm font-semibold text-muted">Apparence</h2>
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-4">
          <span>Thème</span>
          <ThemeSwitcher />
        </div>
      </section>

      <section class="space-y-3" aria-labelledby="fuse">
        <h2 id="fuse" class="text-sm font-semibold text-muted">Mèche</h2>
        <div class="space-y-1 rounded-card bg-surface p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span>Une note dont la mèche est allumée explose après</span>
            <UiSelect
              label="Délai de la mèche"
              :model-value="String(settings.fuseDelayHours)"
              :options="delayOptions"
              @update:model-value="setFuseDelay"
            />
          </div>
          <p class="text-sm text-muted">
            Elle part alors à la corbeille, où elle reste 7 jours. Le délai compte à partir du
            moment où la mèche est allumée ; le changer ici ne touche pas les mèches déjà
            allumées.
          </p>
        </div>
      </section>

      <section class="space-y-3" aria-labelledby="code-notes">
        <h2 id="code-notes" class="text-sm font-semibold text-muted">Notes code</h2>
        <label class="flex items-center justify-between gap-3 rounded-card bg-surface p-4">
          <span>Retour à la ligne automatique</span>
          <input
            type="checkbox"
            class="h-5 w-5 accent-brand"
            :checked="settings.codeLineWrap"
            @change="toggleWrap"
          />
        </label>
      </section>

      <section class="space-y-3" aria-labelledby="about">
        <h2 id="about" class="text-sm font-semibold text-muted">À propos</h2>
        <div class="rounded-card bg-surface p-4">
          <p>
            <span class="font-semibold">Mèche</span>
            <span v-if="version" class="text-muted"> · version {{ version }}</span>
          </p>
          <p class="mt-1 text-sm text-muted">
            Notes personnelles, rapides et colorées. Allume la mèche d'une note jetable : elle
            explose toute seule.
          </p>
        </div>
      </section>
    </div>
  </main>
</template>
