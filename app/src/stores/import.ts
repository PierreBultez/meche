import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { finishTriage, getTriage, importNotes, readImportFile, triageDecide, triageUndo } from "../api/import";
import type { ImportPlan, ImportResult, Triage, TriageDecision, TriageUndo } from "../import/types";
import { useNotesStore } from "./notes";

/**
 * The Standard Notes import (docs/07): the plan shown in the summary, then the triage. Rust keeps
 * the triage (`import_triage`); the « Annuler » history lives here, for the session.
 */
export const useImportStore = defineStore("import", () => {
  const notes = useNotesStore();
  /** The converted backup, waiting for « Importer ». */
  const plan = ref<ImportPlan | null>(null);
  const result = ref<ImportResult | null>(null);
  const triage = ref<Triage | null>(null);
  /** Decisions that « Annuler » can take back, the latest last. */
  const history = ref<TriageUndo[]>([]);

  /** Notes still waiting for the triage (0 before `loadTriage`). */
  const waiting = computed(() => triage.value?.cards.length ?? 0);

  /**
   * Lets the user choose a backup, then converts it. False when the chooser was closed.
   * The converters (and the editor they use) are loaded only now: they stay out of the start.
   */
  async function chooseBackup(): Promise<boolean> {
    const backup = await readImportFile();
    if (backup === null) return false;
    const { planImport } = await import("../import/plan");
    plan.value = planImport(backup);
    result.value = null;
    return true;
  }

  /** Writes the notes of the plan, then shows them in the list and the triage. */
  async function runImport(): Promise<ImportResult> {
    if (!plan.value) throw new Error("no backup to import");
    const { notesToImport } = await import("../import/plan");
    const imported = await importNotes(notesToImport(plan.value));
    result.value = imported;
    plan.value = null;
    history.value = [];
    await Promise.all([loadTriage(), notes.refresh().catch((error: unknown) => console.error("could not reload the list", error))]);
    return imported;
  }

  function forgetPlan(): void {
    plan.value = null;
    result.value = null;
  }

  async function loadTriage(): Promise<Triage> {
    triage.value = await getTriage();
    return triage.value;
  }

  /** Applies a decision to the note on top of the queue. */
  async function decide(decision: TriageDecision): Promise<void> {
    const card = triage.value?.cards[0];
    if (!card) return;
    try {
      history.value.push(await triageDecide(card.id, decision));
    } finally {
      // Even after a failure: the note may have changed meanwhile (trashed elsewhere…).
      await loadTriage();
    }
    if (decision !== "skip" && decision !== "keep") await refreshList();
  }

  /** « Annuler » : takes back the latest decision. */
  async function undo(): Promise<void> {
    const last = history.value.pop();
    if (!last) return;
    try {
      await triageUndo(last);
    } finally {
      await loadTriage();
    }
    if (last.changed) await refreshList();
  }

  /** Closes the final screen: the next triage starts from zero. */
  async function finish(): Promise<void> {
    await finishTriage();
    history.value = [];
    await loadTriage();
  }

  async function refreshList(): Promise<void> {
    await notes.refresh().catch((error: unknown) => console.error("could not reload the list", error));
  }

  return { plan, result, triage, history, waiting, chooseBackup, runImport, forgetPlan, loadTriage, decide, undo, finish };
});
