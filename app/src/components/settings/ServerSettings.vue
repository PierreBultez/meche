<script setup lang="ts">
// Réglages › Serveur (docs/08): log in or create an account (with an invitation code), then
// the state of the sync, « Synchroniser maintenant », « Se déconnecter ».
import { computed, ref } from "vue";
import { checkServer } from "../../api/sync";
import { useNow } from "../../composables/useNow";
import { useSyncNow } from "../../composables/useSyncNow";
import { useSyncStore } from "../../stores/sync";
import { useToastsStore } from "../../stores/toasts";
import { agoText } from "../../utils/relative-date";
import { commandErrorMessage, syncErrorMessage, syncStateText } from "../../utils/sync-messages";
import ConfirmDialog from "../ui/ConfirmDialog.vue";

/** The server of Pierre (CLAUDE.md), offered by default. */
const DEFAULT_SERVER = "https://meche.pierrebultez.com";

const sync = useSyncStore();
const toasts = useToastsStore();
const now = useNow();

const mode = ref<"login" | "register">("login");
const serverUrl = ref(sync.status?.serverUrl ?? DEFAULT_SERVER);
const email = ref(sync.status?.email ?? "");
const password = ref("");
const invitationCode = ref("");
const deviceName = ref(sync.status?.deviceName ?? "");
const busy = ref(false);
const error = ref<string | null>(null);
const checkResult = ref<{ ok: boolean; text: string } | null>(null);
const confirmingSwitch = ref(false);
const syncing = ref(false);

const status = computed(() => sync.status);
const host = computed(() => {
  try {
    return new URL(status.value?.serverUrl ?? "").host;
  } catch {
    return status.value?.serverUrl ?? "";
  }
});
const stateText = computed(() => syncStateText(status.value, (ms) => agoText(ms, now.value)));
const skewMinutes = computed(() =>
  status.value?.clockSkewMs ? Math.round(Math.abs(status.value.clockSkewMs) / 60_000) : 0,
);

async function test(): Promise<void> {
  checkResult.value = null;
  try {
    const found = await checkServer(serverUrl.value);
    serverUrl.value = found.serverUrl;
    checkResult.value = { ok: true, text: "Serveur Mèche trouvé." };
  } catch (failure) {
    checkResult.value = { ok: false, text: commandErrorMessage(failure) };
  }
}

/** The host of an address as typed (https:// may be left out), or null when it is not one. */
function hostOf(address: string): string | null {
  const typed = address.trim();
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`).host;
  } catch {
    return null;
  }
}

/**
 * Syncing this device with another account than the last one, or another server, sends it this
 * device's notes.
 */
const otherAccount = computed(() => {
  const previous = status.value?.email;
  if (previous === null || previous === undefined || previous === "") return false;
  return (
    previous.toLowerCase() !== email.value.trim().toLowerCase() ||
    hostOf(serverUrl.value) !== host.value
  );
});

function submit(): void {
  error.value = null;
  if (otherAccount.value) {
    confirmingSwitch.value = true;
    return;
  }
  void connect();
}

async function connect(): Promise<void> {
  confirmingSwitch.value = false;
  busy.value = true;
  try {
    await sync.login({
      serverUrl: serverUrl.value,
      email: email.value,
      password: password.value,
      deviceName: deviceName.value,
      ...(mode.value === "register" ? { invitationCode: invitationCode.value } : {}),
    });
    password.value = "";
    invitationCode.value = "";
    toasts.show(mode.value === "register" ? "Compte créé : la synchro démarre." : "Connecté : la synchro démarre.");
  } catch (failure) {
    console.error("Login failed", failure);
    error.value = commandErrorMessage(failure);
  } finally {
    busy.value = false;
  }
}

const syncNowAndSay = useSyncNow();
async function syncNow(): Promise<void> {
  syncing.value = true;
  try {
    await syncNowAndSay();
  } finally {
    syncing.value = false;
  }
}

async function logout(): Promise<void> {
  try {
    await sync.logout();
    toasts.show("Déconnecté. Tes notes restent sur cet appareil.");
  } catch (failure) {
    toasts.error("Impossible de se déconnecter.", failure);
  }
}
</script>

<template>
  <div class="space-y-3 rounded-card bg-surface p-4">
    <template v-if="status?.loggedIn">
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-muted">Serveur</dt>
        <dd class="min-w-0 truncate">{{ host }}</dd>
        <dt class="text-muted">Compte</dt>
        <dd class="min-w-0 truncate">{{ status.email }}</dd>
        <dt class="text-muted">Cet appareil</dt>
        <dd class="min-w-0 truncate">{{ status.deviceName }}</dd>
      </dl>
      <p class="text-sm" :class="status.state === 'error' ? 'text-danger' : 'text-muted'">
        {{ stateText }}
      </p>
      <p v-if="skewMinutes > 0" class="text-sm text-danger">
        L'horloge de cet appareil a {{ skewMinutes }} min d'écart avec le serveur : les mèches
        exploseront en décalé. Règle l'heure du système.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-button bg-brand px-3 py-1.5 font-semibold text-on-brand disabled:opacity-60"
          :disabled="syncing"
          @click="syncNow"
        >
          {{ syncing ? "Synchronisation…" : "Synchroniser maintenant" }}
        </button>
        <button
          type="button"
          class="rounded-button bg-surface-2 px-3 py-1.5 font-semibold text-text hover:ring-1 hover:ring-border"
          @click="logout"
        >
          Se déconnecter
        </button>
      </div>
    </template>

    <form v-else class="space-y-3" @submit.prevent="submit">
      <p v-if="status?.errorKind === 'unauthorized'" class="text-sm text-danger" role="alert">
        {{ syncErrorMessage("unauthorized") }}
      </p>
      <p v-else class="text-sm text-muted">
        Connecte un serveur Mèche pour retrouver tes notes sur tous tes appareils. Sans serveur,
        elles restent sur celui-ci.
      </p>
      <div class="flex gap-1 rounded-button bg-surface-2 p-1 text-sm" role="group" aria-label="Compte">
        <button
          type="button"
          class="flex-1 rounded-[8px] px-2 py-1 font-semibold"
          :class="mode === 'login' ? 'bg-bg text-text' : 'text-muted hover:text-text'"
          :aria-pressed="mode === 'login'"
          @click="mode = 'login'"
        >
          J'ai un compte
        </button>
        <button
          type="button"
          class="flex-1 rounded-[8px] px-2 py-1 font-semibold"
          :class="mode === 'register' ? 'bg-bg text-text' : 'text-muted hover:text-text'"
          :aria-pressed="mode === 'register'"
          @click="mode = 'register'"
        >
          Créer un compte
        </button>
      </div>

      <div class="text-sm">
        <label for="server-url" class="text-muted">Adresse du serveur</label>
        <div class="mt-1 flex gap-2">
          <input
            id="server-url"
            v-model="serverUrl"
            type="url"
            required
            autocomplete="url"
            class="min-w-0 flex-1 rounded-button bg-surface-2 px-2.5 py-1.5 text-text"
            @input="checkResult = null"
          />
          <button
            type="button"
            class="rounded-button bg-surface-2 px-3 py-1.5 font-semibold text-text hover:ring-1 hover:ring-border"
            @click="test"
          >
            Tester
          </button>
        </div>
      </div>
      <p v-if="checkResult" class="text-sm" :class="checkResult.ok ? 'text-muted' : 'text-danger'" role="status">
        {{ checkResult.text }}
      </p>

      <div v-if="mode === 'register'" class="text-sm">
        <label for="server-invitation-code" class="text-muted">Code d'invitation</label>
        <input
          id="server-invitation-code"
          v-model="invitationCode"
          type="text"
          required
          autocomplete="off"
          spellcheck="false"
          placeholder="XXXX-XXXX-XXXX"
          aria-describedby="server-invitation-help"
          class="mt-1 w-full rounded-button bg-surface-2 px-2.5 py-1.5 font-mono uppercase text-text placeholder:text-muted"
        />
        <p id="server-invitation-help" class="mt-1 text-muted">
          Demande-le à une personne qui a déjà un compte sur ce serveur.
        </p>
      </div>

      <label class="block text-sm">
        <span class="text-muted">Adresse e-mail</span>
        <input
          v-model="email"
          type="email"
          required
          autocomplete="username"
          class="mt-1 w-full rounded-button bg-surface-2 px-2.5 py-1.5 text-text"
        />
      </label>
      <div class="text-sm">
        <label for="server-password" class="text-muted">Mot de passe</label>
        <input
          id="server-password"
          v-model="password"
          type="password"
          required
          :minlength="mode === 'register' ? 12 : undefined"
          :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
          :aria-describedby="mode === 'register' ? 'server-password-help' : undefined"
          class="mt-1 w-full rounded-button bg-surface-2 px-2.5 py-1.5 text-text"
        />
        <p v-if="mode === 'register'" id="server-password-help" class="mt-1 text-muted">
          12 caractères au moins. Une phrase de passe est idéale.
        </p>
      </div>
      <label class="block text-sm">
        <span class="text-muted">Nom de cet appareil</span>
        <input
          v-model="deviceName"
          type="text"
          maxlength="100"
          class="mt-1 w-full rounded-button bg-surface-2 px-2.5 py-1.5 text-text"
        />
      </label>

      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <button
        type="submit"
        class="rounded-button bg-brand px-3 py-1.5 font-semibold text-on-brand disabled:opacity-60"
        :disabled="busy"
      >
        {{ busy ? "Connexion…" : mode === "register" ? "Créer le compte" : "Se connecter" }}
      </button>
    </form>

    <ConfirmDialog
      :open="confirmingSwitch"
      title="Changer de compte ?"
      :message="`Cet appareil était synchronisé avec le compte ${status?.email} (${host}). Ses notes seront envoyées vers le compte ${email.trim()} (${hostOf(serverUrl) ?? serverUrl}).`"
      confirm-label="Continuer"
      @confirm="connect"
      @cancel="confirmingSwitch = false"
    />
  </div>
</template>
