<script setup lang="ts">
// Réglages › Inviter quelqu'un: a code creates one account on this server, within 7 days.
// Anyone with an account can invite someone they trust. The code is shown only once.
import { Copy } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { createInvitation, deleteInvitation, listInvitations } from "../../api/sync";
import { useToastsStore } from "../../stores/toasts";
import type { Invitation } from "../../types/sync";
import { fullDate } from "../../utils/relative-date";
import { commandErrorMessage } from "../../utils/sync-messages";

const toasts = useToastsStore();
const invitations = ref<Invitation[] | null>(null);
const loadError = ref<string | null>(null);
const created = ref<Invitation | null>(null);
const creating = ref(false);

async function load(): Promise<void> {
  try {
    invitations.value = await listInvitations();
    loadError.value = null;
  } catch (error) {
    console.error("Could not list the invitations", error);
    loadError.value = commandErrorMessage(error);
  }
}

onMounted(load);

async function create(): Promise<void> {
  creating.value = true;
  try {
    created.value = await createInvitation();
    await load();
  } catch (error) {
    toasts.error(commandErrorMessage(error), error);
  } finally {
    creating.value = false;
  }
}

async function copy(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    toasts.show("Code copié.");
  } catch (error) {
    toasts.error("Impossible de copier le code.", error);
  }
}

async function withdraw(invitation: Invitation): Promise<void> {
  try {
    await deleteInvitation(invitation.id);
    if (created.value?.id === invitation.id) created.value = null;
    await load();
  } catch (error) {
    toasts.error(commandErrorMessage(error), error);
  }
}

function describe(invitation: Invitation): string {
  if (invitation.usedAt !== null) {
    return `utilisé par ${invitation.usedByEmail ?? "un compte supprimé"} le ${fullDate(invitation.usedAt)}`;
  }
  return invitation.expiresAt <= Date.now() ? "expiré" : `valable jusqu'au ${fullDate(invitation.expiresAt)}`;
}

const pending = (invitation: Invitation) => invitation.usedAt === null && invitation.expiresAt > Date.now();
</script>

<template>
  <div class="space-y-3 rounded-card bg-surface p-4">
    <p class="text-sm text-muted">
      Un code permet à une personne de confiance de créer son compte sur ce serveur, dans les 7
      jours. Elle pourra à son tour inviter quelqu'un. Ses notes sont séparées des tiennes.
    </p>
    <div v-if="created?.code" class="flex flex-wrap items-center gap-3 rounded-button bg-surface-2 p-3">
      <span class="font-mono text-lg font-semibold tracking-wider" data-invitation-code>{{ created.code }}</span>
      <button
        type="button"
        class="flex items-center gap-1 rounded-button px-2 py-1 text-sm font-semibold text-brand hover:bg-surface"
        @click="copy(created.code)"
      >
        <Copy :size="15" aria-hidden="true" /> Copier
      </button>
      <span class="w-full text-sm text-muted">Il ne sera plus affiché : copie-le maintenant.</span>
    </div>
    <button
      type="button"
      class="rounded-button bg-surface-2 px-3 py-1.5 font-semibold text-text hover:ring-1 hover:ring-border disabled:opacity-60"
      :disabled="creating"
      @click="create"
    >
      Créer un code d'invitation
    </button>
    <p v-if="loadError" class="text-sm text-danger">{{ loadError }}</p>
    <ul v-else-if="invitations && invitations.length > 0" class="divide-y divide-border text-sm">
      <li v-for="invitation in invitations" :key="invitation.id" class="flex items-center gap-3 py-1.5">
        <span class="font-mono">…{{ invitation.hint }}</span>
        <span class="min-w-0 flex-1 truncate text-muted">{{ describe(invitation) }}</span>
        <button
          v-if="pending(invitation)"
          type="button"
          class="rounded-button px-2 py-0.5 font-semibold text-danger hover:bg-surface-2"
          :aria-label="`Retirer le code …${invitation.hint}`"
          @click="withdraw(invitation)"
        >
          Retirer
        </button>
      </li>
    </ul>
  </div>
</template>
