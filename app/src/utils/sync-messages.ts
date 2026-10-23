// French messages for the errors of the sync and of the account (docs/11, "Ton des textes").
// Rust sends a stable `kind` (src-tauri/src/error.rs); the text is written here.
import type { CommandError } from "../types/note";
import type { SyncStatus } from "../types/sync";

const MESSAGES: Record<string, string> = {
  network: "Serveur injoignable. La synchro reprendra toute seule.",
  unauthorized: "Cet appareil a été déconnecté du serveur. Reconnecte-toi pour reprendre la synchro.",
  rate_limited: "Trop d'essais. Réessaie dans une minute.",
  invalid_credentials: "Adresse e-mail ou mot de passe incorrect.",
  invalid_invitation: "Ce code d'invitation n'existe pas, a déjà servi ou a expiré.",
  invalid_email: "Cette adresse e-mail n'est pas valide.",
  email_taken: "Un compte utilise déjà cette adresse e-mail.",
  weak_password: "Le mot de passe doit faire au moins 12 caractères.",
  too_many_invitations: "Tu as déjà 5 codes d'invitation en attente. Retires-en un d'abord.",
  not_meche_server: "Aucun serveur Mèche à cette adresse.",
  invalid_input: "Adresse du serveur invalide. Exemple : https://meche.pierrebultez.com",
  not_connected: "Cet appareil n'est connecté à aucun serveur.",
  not_found: "Introuvable sur le serveur : la liste a changé entre-temps.",
  invalid_change:
    "Le serveur refuse une note de cet appareil : la synchro est bloquée. Tes notes restent ici.",
};

/** The message for an error kind (or a generic one). */
export function syncErrorMessage(kind: string | null | undefined): string {
  return (kind && MESSAGES[kind]) || "Le serveur a rencontré une erreur. La synchro réessaiera.";
}

/** The message for a failed command. */
export function commandErrorMessage(error: unknown): string {
  return syncErrorMessage((error as CommandError | undefined)?.kind);
}

/** One line describing the state of the sync (the dot of the list, the settings). */
export function syncStateText(status: SyncStatus | null, time: (ms: number) => string): string {
  if (status === null || !status.loggedIn) {
    return status?.errorKind === "unauthorized"
      ? syncErrorMessage("unauthorized")
      : "Synchro désactivée : tes notes restent sur cet appareil.";
  }
  switch (status.state) {
    case "syncing":
      return "Synchronisation…";
    case "offline":
      return syncErrorMessage("network");
    case "error":
      return syncErrorMessage(status.errorKind);
    default:
      return status.lastSyncAt === null
        ? "Pas encore synchronisé."
        : `À jour (dernière synchro ${time(status.lastSyncAt)}).`;
  }
}
