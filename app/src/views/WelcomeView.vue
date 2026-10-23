<script setup lang="ts">
// First launch (docs/08): « Connecter un serveur » or « Utiliser hors ligne pour l'instant ».
// Shown until one of them is chosen, while no server is connected.
import { Cloud, Laptop } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { useSettingsStore } from "../stores/settings";
import { useToastsStore } from "../stores/toasts";

const settings = useSettingsStore();
const toasts = useToastsStore();
const router = useRouter();

async function choose(connect: boolean): Promise<void> {
  // Saved first: the choice is not asked again, even if the page then fails to open.
  await settings
    .setWelcomeDone()
    .catch((error: unknown) => toasts.error("Impossible d'enregistrer ce choix.", error));
  await router.replace(connect ? { name: "settings", hash: "#server" } : "/notes");
}
</script>

<template>
  <main class="flex h-screen items-center justify-center overflow-y-auto bg-bg px-6 text-text">
    <div class="w-full max-w-md space-y-6 py-8 text-center">
      <h1 class="text-5xl font-semibold text-brand">mèche</h1>
      <p class="text-muted">
        Tes notes sont enregistrées sur cet appareil et tout marche sans réseau. Pour les retrouver
        sur ton téléphone et tes autres ordinateurs, connecte un serveur Mèche.
      </p>
      <div class="space-y-3">
        <button
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-button bg-brand px-4 py-3 font-semibold text-on-brand"
          @click="choose(true)"
        >
          <Cloud :size="18" aria-hidden="true" />
          Connecter un serveur
        </button>
        <button
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-button bg-surface-2 px-4 py-3 font-semibold text-text hover:ring-1 hover:ring-border"
          @click="choose(false)"
        >
          <Laptop :size="18" aria-hidden="true" />
          Utiliser hors ligne pour l'instant
        </button>
      </div>
      <p class="text-sm text-muted">Tu pourras connecter un serveur plus tard dans les réglages.</p>
    </div>
  </main>
</template>
