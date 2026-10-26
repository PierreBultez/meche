<script setup lang="ts">
// Import from Standard Notes (docs/07, section 4): choose the backup, read the summary, import,
// then go to the triage.
import { ArrowLeft, FileUp, TriangleAlert } from "lucide-vue-next";
import { computed, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { foundText, leftOutText, notesToCheck, triageMinutes } from "../import/summary";
import { useImportStore } from "../stores/import";
import { useSyncStore } from "../stores/sync";
import { useToastsStore } from "../stores/toasts";
import { importErrorMessage } from "../utils/import-messages";

const store = useImportStore();
const sync = useSyncStore();
const toasts = useToastsStore();
const router = useRouter();

/** What the page is doing: choosing and converting, or writing the notes. */
const busy = ref<"reading" | "importing" | null>(null);

const plan = computed(() => store.plan);
const toImport = computed(() => plan.value?.notes.filter((note) => note.importable).length ?? 0);
const toCheck = computed(() => (plan.value ? notesToCheck(plan.value) : []));
const result = computed(() => store.result);
const chooseLabel = computed(() => {
  if (busy.value !== "reading") return "Choisir la sauvegarde…";
  const progress = store.progress;
  return progress ? `Conversion des notes… ${progress.done} / ${progress.total}` : "Lecture de la sauvegarde…";
});

async function choose(): Promise<void> {
  busy.value = "reading";
  try {
    await store.chooseBackup();
  } catch (error) {
    toasts.error(importErrorMessage(error, "Impossible de lire cette sauvegarde."), error);
  } finally {
    busy.value = null;
  }
}

async function runImport(): Promise<void> {
  busy.value = "importing";
  try {
    await store.runImport();
  } catch (error) {
    toasts.error(importErrorMessage(error, "L'import a échoué : rien n'a été importé."), error);
  } finally {
    busy.value = null;
  }
}

function cancel(): void {
  store.forgetPlan();
}

// Coming back later starts again from the choice of the backup.
onBeforeUnmount(() => store.forgetPlan());

async function startTriage(): Promise<void> {
  store.forgetPlan();
  await router.push("/tri");
}

async function later(): Promise<void> {
  store.forgetPlan();
  await router.push("/notes");
}
</script>

<template>
  <main class="h-screen overflow-y-auto bg-bg text-text">
    <div class="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header class="flex items-center gap-3">
        <RouterLink
          to="/settings"
          class="rounded-button p-2 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Retour aux réglages"
          title="Retour aux réglages (Échap)"
        >
          <ArrowLeft :size="20" aria-hidden="true" />
        </RouterLink>
        <h1 class="text-2xl font-semibold">Importer depuis Standard Notes</h1>
      </header>

      <!-- After the import -->
      <section v-if="result" class="space-y-4 rounded-card bg-surface p-5" aria-live="polite">
        <template v-if="result.imported > 0">
          <p class="text-lg font-semibold">
            {{ result.imported }} {{ result.imported > 1 ? "notes importées" : "note importée" }}.
          </p>
          <p v-if="result.alreadyImported" class="text-muted">
            {{ result.alreadyImported }}
            {{ result.alreadyImported > 1 ? "étaient déjà dans Mèche : elles n'ont pas été importées à nouveau." : "était déjà dans Mèche : elle n'a pas été importée à nouveau." }}
          </p>
          <p v-if="sync.loggedIn" class="text-muted">
            {{ result.imported > 1 ? "Elles partent" : "Elle part" }} vers le serveur à la prochaine synchronisation.
          </p>
        </template>
        <p v-else class="text-lg font-semibold">Rien de nouveau : ces notes sont déjà dans Mèche.</p>
        <template v-if="store.waiting > 0">
          <p>Faire le tri maintenant ? (environ {{ triageMinutes(store.waiting) }} min)</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded-button bg-brand px-3 py-1.5 font-semibold text-on-brand" @click="startTriage">
              Trier maintenant
            </button>
            <button
              type="button"
              class="rounded-button bg-surface-2 px-3 py-1.5 font-semibold text-text hover:ring-1 hover:ring-border"
              @click="later"
            >
              Plus tard
            </button>
          </div>
          <p class="text-sm text-muted">Le tri reste possible plus tard, depuis les réglages ou la palette (Ctrl+K).</p>
        </template>
        <button
          v-else
          type="button"
          class="rounded-button bg-brand px-3 py-1.5 font-semibold text-on-brand"
          @click="later"
        >
          Voir mes notes
        </button>
      </section>

      <!-- The summary -->
      <section v-else-if="plan" class="space-y-4" aria-live="polite">
        <div class="space-y-2 rounded-card bg-surface p-5">
          <p class="text-lg font-semibold">{{ foundText(plan) }}</p>
          <p v-if="toCheck.length === 0 && toImport > 0" class="text-muted">Tout a été converti à l'identique.</p>
          <p v-if="leftOutText(plan)" class="text-sm text-muted">{{ leftOutText(plan) }}</p>
        </div>

        <div v-if="toCheck.length" class="space-y-2 rounded-card bg-surface p-5">
          <p class="flex items-center gap-2 font-semibold">
            <TriangleAlert :size="18" class="text-spark" aria-hidden="true" />
            {{ toCheck.length }}
            {{ toCheck.length > 1 ? "notes non converties parfaitement" : "note non convertie parfaitement" }}
          </p>
          <ul class="space-y-1">
            <li v-for="(note, index) in toCheck" :key="index" class="text-sm">
              <span class="font-semibold" :class="note.importable ? '' : 'text-danger'">{{ note.title }}</span>
              <span class="text-muted"> — {{ note.details }}</span>
            </li>
          </ul>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-button bg-brand px-3 py-1.5 font-semibold text-on-brand disabled:opacity-60"
            :disabled="busy !== null || toImport === 0"
            @click="runImport"
          >
            {{ busy === "importing" ? "Import…" : `Importer ${toImport} ${toImport > 1 ? "notes" : "note"}` }}
          </button>
          <button
            type="button"
            class="rounded-button bg-surface-2 px-3 py-1.5 font-semibold text-text hover:ring-1 hover:ring-border disabled:opacity-60"
            :disabled="busy !== null"
            @click="cancel"
          >
            Annuler
          </button>
        </div>
      </section>

      <!-- Choosing the backup -->
      <section v-else class="space-y-4 rounded-card bg-surface p-5">
        <p>
          Dans Standard Notes, ouvre <strong>Préférences › Sauvegardes</strong> et télécharge une
          sauvegarde de tes données <strong>sans chiffrement</strong>. Choisis ensuite ici le fichier
          <code>.zip</code> obtenu (ou le fichier <code>.txt</code> qu'il contient).
        </p>
        <p class="text-sm text-muted">
          Rien n'est importé avant ton accord : un récapitulatif s'affiche d'abord. Relancer l'import
          avec la même sauvegarde ne crée pas de doublons.
        </p>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-button bg-brand px-3 py-1.5 font-semibold text-on-brand disabled:opacity-60"
          :disabled="busy !== null"
          @click="choose"
        >
          <FileUp :size="18" aria-hidden="true" />
          {{ chooseLabel }}
        </button>
      </section>
    </div>
  </main>
</template>
