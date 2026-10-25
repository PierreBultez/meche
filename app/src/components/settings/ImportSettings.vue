<script setup lang="ts">
// Settings › Importer depuis Standard Notes (docs/07): the import, and the triage when notes wait.
import { FileUp, ListChecks } from "lucide-vue-next";
import { onMounted } from "vue";
import { useImportStore } from "../../stores/import";

const store = useImportStore();

onMounted(() => {
  store.loadTriage().catch((error: unknown) => console.error("could not read the triage", error));
});
</script>

<template>
  <div class="space-y-3 rounded-card bg-surface p-4">
    <p>
      Récupère les notes d'une sauvegarde de Standard Notes : un récapitulatif s'affiche avant
      l'import, puis un tri rapide, note par note.
    </p>
    <div class="flex flex-wrap gap-2">
      <RouterLink
        to="/import"
        class="inline-flex items-center gap-2 rounded-button bg-surface-2 px-3 py-1.5 font-semibold text-text hover:ring-1 hover:ring-border"
      >
        <FileUp :size="18" aria-hidden="true" />
        Importer depuis Standard Notes
      </RouterLink>
      <RouterLink
        v-if="store.waiting > 0"
        to="/tri"
        class="inline-flex items-center gap-2 rounded-button bg-brand px-3 py-1.5 font-semibold text-on-brand"
      >
        <ListChecks :size="18" aria-hidden="true" />
        Reprendre le tri ({{ store.waiting }} {{ store.waiting > 1 ? "notes" : "note" }})
      </RouterLink>
    </div>
  </div>
</template>
