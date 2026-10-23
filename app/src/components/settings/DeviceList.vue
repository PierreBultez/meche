<script setup lang="ts">
// Réglages › Appareils connectés: one line per device of the account. A lost phone is
// disconnected from here: its token stops working at once.
import { onMounted, ref } from "vue";
import { listDevices, revokeDevice } from "../../api/sync";
import { useNow } from "../../composables/useNow";
import { useToastsStore } from "../../stores/toasts";
import type { Device } from "../../types/sync";
import { agoText } from "../../utils/relative-date";
import { commandErrorMessage } from "../../utils/sync-messages";
import ConfirmDialog from "../ui/ConfirmDialog.vue";

const toasts = useToastsStore();
const now = useNow();
const devices = ref<Device[] | null>(null);
const loadError = ref<string | null>(null);
const revoking = ref<Device | null>(null);

async function load(): Promise<void> {
  try {
    devices.value = await listDevices();
    loadError.value = null;
  } catch (error) {
    console.error("Could not list the devices", error);
    loadError.value = commandErrorMessage(error);
  }
}

onMounted(load);

async function revoke(): Promise<void> {
  const device = revoking.value;
  revoking.value = null;
  if (device === null) return;
  try {
    await revokeDevice(device.id);
    toasts.show(`« ${device.name} » est déconnecté.`);
    await load();
  } catch (error) {
    toasts.error(commandErrorMessage(error), error);
  }
}
</script>

<template>
  <div class="rounded-card bg-surface p-4">
    <p v-if="loadError" class="text-sm text-danger">{{ loadError }}</p>
    <p v-else-if="devices === null" class="text-sm text-muted">Chargement…</p>
    <ul v-else class="divide-y divide-border">
      <li v-for="device in devices" :key="device.id" class="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
        <div class="min-w-0 flex-1">
          <p class="truncate">
            {{ device.name }}
            <span v-if="device.current" class="text-sm text-muted">· cet appareil</span>
          </p>
          <p class="text-sm text-muted">
            {{ device.lastUsedAt === null ? "Jamais synchronisé" : `Actif ${agoText(device.lastUsedAt, now)}` }}
          </p>
        </div>
        <button
          v-if="!device.current"
          type="button"
          class="rounded-button px-2 py-1 text-sm font-semibold text-danger hover:bg-surface-2"
          @click="revoking = device"
        >
          Déconnecter
        </button>
      </li>
    </ul>
    <ConfirmDialog
      :open="revoking !== null"
      title="Déconnecter cet appareil ?"
      :message="`« ${revoking?.name} » ne se synchronisera plus. Ses notes restent dessus ; il faudra se reconnecter pour reprendre la synchro.`"
      confirm-label="Déconnecter"
      @confirm="revoke"
      @cancel="revoking = null"
    />
  </div>
</template>
