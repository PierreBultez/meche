// French messages of the import errors (codes of src-tauri/src/error.rs, docs/07).
import type { CommandError } from "../types/note";

const MESSAGES: Record<string, string> = {
  backup_invalid: "Ce fichier n'est pas une sauvegarde Standard Notes.",
  backup_encrypted:
    "Cette sauvegarde est chiffrée. Dans Standard Notes, télécharge une sauvegarde sans chiffrement.",
  backup_too_large: "Cette sauvegarde est trop grosse : 64 Mo au plus.",
  backup_location: "Impossible d'ouvrir un fichier à cet emplacement.",
  io: "Impossible de lire ce fichier.",
  invalid_input: "Une note de la sauvegarde ne peut pas être importée. Rien n'a été importé.",
};

export function importErrorMessage(error: unknown, fallback: string): string {
  const kind = (error as CommandError | undefined)?.kind;
  return kind && Object.hasOwn(MESSAGES, kind) ? MESSAGES[kind] : fallback;
}
