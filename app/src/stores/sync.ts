import { defineStore } from "pinia";
import { computed, ref } from "vue";
import * as api from "../api/sync";
import type { LoginForm, SyncStatus } from "../types/sync";

/**
 * State of the sync, sent by Rust (`sync-status`, composables/useSyncStatus.ts). Its own store:
 * the note list never reads it, so the sync dot changing color never redraws the list.
 */
export const useSyncStore = defineStore("sync", () => {
  const status = ref<SyncStatus | null>(null);
  const loggedIn = computed(() => status.value?.loggedIn ?? false);

  async function load(): Promise<void> {
    status.value = await api.getSyncStatus();
  }

  function apply(next: SyncStatus): void {
    status.value = next;
  }

  async function syncNow(): Promise<SyncStatus> {
    const next = await api.syncNow();
    status.value = next;
    return next;
  }

  async function login(form: LoginForm): Promise<SyncStatus> {
    const next = await api.login(form);
    status.value = next;
    return next;
  }

  async function logout(): Promise<SyncStatus> {
    const next = await api.logout();
    status.value = next;
    return next;
  }

  return { status, loggedIn, load, apply, syncNow, login, logout };
});
