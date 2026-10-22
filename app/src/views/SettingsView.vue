<script setup lang="ts">
// Settings (docs/08, "Écrans secondaires"). Phase 1: appearance and code notes.
import { getVersion } from "@tauri-apps/api/app";
import { ArrowLeft } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import ThemeSwitcher from "../components/ThemeSwitcher.vue";
import { useSettingsStore } from "../stores/settings";
import { useToastsStore } from "../stores/toasts";

const settings = useSettingsStore();
const toasts = useToastsStore();
const version = ref("");

onMounted(async () => {
  version.value = await getVersion().catch(() => "");
});

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
          to="/notes"
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
            Notes personnelles, rapides et colorées. Allumez la mèche d'une note jetable : elle
            explose toute seule.
          </p>
        </div>
      </section>
    </div>
  </main>
</template>
