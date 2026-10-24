import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useSyncStore } from "../stores/sync";
import { useToastsStore } from "../stores/toasts";
import type { SyncStatus } from "../types/sync";
import { onSyncStatus } from "./useSyncStatus";

const idle: SyncStatus = {
  state: "idle",
  errorKind: null,
  message: null,
  loggedIn: true,
  serverUrl: "https://m.example",
  email: "p@example.com",
  deviceName: "PC",
  lastSyncAt: 1,
  clockSkewMs: null,
  conflicts: 0,
};

describe("sync-status event", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("updates the store, quietly when nothing conflicted", () => {
    onSyncStatus(idle);
    expect(useSyncStore().status).toEqual(idle);
    expect(useToastsStore().toasts).toEqual([]);
  });

  it("announces the conflict copies", () => {
    onSyncStatus({ ...idle, conflicts: 2 });
    expect(useToastsStore().toasts[0].message).toContain("2 notes ont été modifiées ici et sur un autre appareil");
  });
});
