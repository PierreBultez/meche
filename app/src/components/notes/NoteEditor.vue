<script setup lang="ts">
// An open note (docs/05, docs/08): header, then the rich or code editor. Mounted again
// (`:key`) whenever the note or its kind changes, so editors read the content only once.
import { Pin, PinOff, RotateCcw, Trash2 } from "lucide-vue-next";
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAutosave } from "../../composables/useAutosave";
import { useNoteActions } from "../../composables/useNoteActions";
import { useNow } from "../../composables/useNow";
import { useNotesStore } from "../../stores/notes";
import { useSettingsStore } from "../../stores/settings";
import { useToastsStore } from "../../stores/toasts";
import { useUiStore } from "../../stores/ui";
import type { Note, NoteColor } from "../../types/note";
import { noteAsMarkdown } from "../../utils/note-markdown";
import type CodeEditorComponent from "../editor/CodeEditor.vue";
import type RichEditorComponent from "../editor/RichEditor.vue";
import { CODE_LANGUAGES, normalizeLanguage } from "../../editor/languages";
import FuseIcon from "../fuse/FuseIcon.vue";
import FuseTimeLeft from "../fuse/FuseTimeLeft.vue";
import ConfirmDialog from "../ui/ConfirmDialog.vue";
import UiSelect from "../ui/UiSelect.vue";
import NoteMenu from "./NoteMenu.vue";

// Editors are loaded the first time a note of their kind is opened, not at startup (docs/08).
const RichEditor = defineAsyncComponent(() => import("../editor/RichEditor.vue"));
const CodeEditor = defineAsyncComponent(() => import("../editor/CodeEditor.vue"));

const props = defineProps<{ note: Note }>();

const notes = useNotesStore();
const settings = useSettingsStore();
const toasts = useToastsStore();
const ui = useUiStore();
const router = useRouter();
const actions = useNoteActions();

const id = props.note.id;
const inTrash = computed(() => props.note.trashedAt !== null);
const fuseLit = computed(() => props.note.ephemeralMode !== null);
const exploded = computed(() => props.note.trashReason === "self_destruct");
/** Restoring puts the fuse out: the note exploded, or its fuse burnt out in the trash (Rust,
 * db::notes::restore). */
const now = useNow();
const restoresWithoutFuse = computed(
  () =>
    exploded.value || (props.note.destroyAt !== null && props.note.destroyAt <= now.value),
);
const restoreButton = ref<HTMLButtonElement | null>(null);
const header = ref<HTMLElement | null>(null);

// The open note exploded: its header buttons are about to disappear. If one of them has the
// focus, it is given to « Restaurer » rather than lost. Only then: from the text, the next key
// typed (Espace, Entrée) must not press the button. The watcher runs before the page is
// updated, so the header is still there to be checked.
watch(inTrash, async (trashed) => {
  const active = document.activeElement;
  if (!trashed || !header.value?.contains(active)) return;
  await nextTick();
  // The title field stays (read-only): only a button that was removed hands the focus over.
  if (!active?.isConnected) restoreButton.value?.focus();
});
const rich = ref<InstanceType<typeof RichEditorComponent> | null>(null);
const code = ref<InstanceType<typeof CodeEditorComponent> | null>(null);
const menu = ref<InstanceType<typeof NoteMenu> | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);
const title = ref(props.note.title);
const confirmingDelete = ref(false);

const saveFailed = (error: unknown) =>
  toasts.error("Impossible d'enregistrer la note. Tes dernières modifications sont gardées ici.", error);

/** A save found the note changed on another device: Rust kept what was typed in a copy. */
let keptInCopy = false;

const titleSave = useAutosave({
  initial: props.note.title,
  read: () => title.value,
  write: async (value, expected) => {
    const saved = await notes.save(id, { title: value, expectedTitle: expected });
    if (saved.title !== value) keptInCopy = true;
    return saved.title;
  },
  onError: saveFailed,
});

/** The text in the editor, which may be newer than the saved one. */
function currentContent(): string {
  return props.note.kind === "rich"
    ? (rich.value?.getMarkdown() ?? props.note.content)
    : (code.value?.getText() ?? props.note.content);
}

const contentSave = useAutosave({
  initial: props.note.content,
  read: currentContent,
  write: async (value, expected) => {
    const saved = await notes.save(id, { content: value, expectedContent: expected });
    if (saved.content !== value) keptInCopy = true;
    return saved.content;
  },
  onError: saveFailed,
});

async function flush(): Promise<void> {
  await Promise.all([titleSave.flush(), contentSave.flush()]);
}

// The note shown here changed without this editor writing it: the sync brought the version of
// another device (docs/04). Editors read the text only when they are mounted, so the editor is
// mounted again on the new version. What was being typed is saved first: since the note
// changed, Rust does not write it over the new version but keeps it in a conflict copy.
let reloading = false;
async function reloadEditor(): Promise<void> {
  if (reloading) return;
  reloading = true;
  // A failed save is already reported (saveFailed); the editor is reloaded anyway, on what
  // is stored.
  await flush().catch(() => undefined);
  if (keptInCopy) {
    toasts.show(
      "Cette note a changé sur un autre appareil. Ce que tu venais d'écrire est gardé dans une copie « (conflit du …) ».",
    );
  }
  await notes.reopen(id).catch((error: unknown) => toasts.error("Impossible de recharger la note.", error));
}
watch(
  () => [props.note.title, props.note.content] as const,
  ([noteTitle, noteContent]) => {
    if (keptInCopy || !titleSave.knows(noteTitle) || !contentSave.knows(noteContent)) {
      void reloadEditor();
    }
  },
);

/** Focuses the text: at its start, or (null) where the caret already is. */
function focusEditor(position: "start" | null = "start"): void {
  if (props.note.kind === "rich") rich.value?.focus(position);
  else code.value?.focus();
}

async function patch(change: Parameters<typeof notes.save>[1], failure: string): Promise<void> {
  try {
    await notes.save(id, change);
  } catch (error) {
    toasts.error(failure, error);
  }
}

const togglePin = () => actions.togglePin(props.note);
const toggleFuse = () => actions.toggleFuse(props.note);
const setColor = (color: NoteColor) => actions.setColor(props.note, color);

const languageOptions = CODE_LANGUAGES.map(({ id: value, label }) => ({ value, label }));

async function setLanguage(codeLanguage: string): Promise<void> {
  await patch({ codeLanguage }, "Impossible de changer le langage.");
}

// The text gets the focus when the note was opened from the keyboard, or when the focus was
// lost with the previous note's editor (palette, conversion): typing then goes somewhere.
const editorReady = ref(false);
function focusTextIfWanted(): void {
  const active = document.activeElement;
  const lost = active === null || active === document.body;
  // The request names its note: the note being left never takes it.
  const asked = ui.editorFocusPending === id;
  if (!asked && !lost) return;
  if (asked) ui.editorFocusPending = null;
  // A note in the trash is read-only: the focus stays where it is (its card).
  if (!inTrash.value) focusEditor(null);
}
function onEditorReady(): void {
  editorReady.value = true;
  // After the current render, once the editor's template ref is set.
  void nextTick(focusTextIfWanted);
}
// The same note asked again (Entrée on its card): no new editor, focus it now.
watch(
  () => ui.editorFocusPending,
  (target) => {
    if (target === id && editorReady.value) focusTextIfWanted();
  },
);

// A brand new note: start typing its title right away.
onMounted(() => {
  if (props.note.title === "" && props.note.content === "" && !inTrash.value) {
    titleInput.value?.focus();
  }
});

const convert = () => actions.convert(props.note);

async function copyMarkdown(): Promise<void> {
  const markdown = noteAsMarkdown(props.note.kind, currentContent(), props.note.codeLanguage);
  try {
    await navigator.clipboard.writeText(markdown);
    toasts.show("Markdown copié.");
  } catch (error) {
    toasts.error("Impossible de copier la note.", error);
  }
}

async function toggleWrap(): Promise<void> {
  await settings
    .setCodeLineWrap(!settings.codeLineWrap)
    .catch((error: unknown) => toasts.error("Impossible d'enregistrer ce réglage.", error));
}

const moveToTrash = () => actions.trash(id);
const restore = () => actions.restore(id);

async function deleteForever(): Promise<void> {
  confirmingDelete.value = false;
  try {
    await notes.deleteForever(id);
    await router.push("/notes");
    toasts.show("Note supprimée définitivement.");
  } catch (error) {
    toasts.error("Impossible de supprimer la note.", error);
  }
}

async function onTitleEnter(): Promise<void> {
  await nextTick();
  focusEditor();
}

defineExpose({
  flush,
  focusTitle: () => titleInput.value?.focus(),
  togglePin,
  toggleFuse,
  moveToTrash,
  toggleMenu: () => menu.value?.toggle(),
});
</script>

<template>
  <article :data-note-color="note.color" class="flex h-full min-h-0 flex-col">
    <header
      v-if="!ui.focusMode"
      ref="header"
      class="flex w-full items-center gap-1 px-6 pb-2 pt-4"
      :class="note.kind === 'rich' ? 'mx-auto max-w-[calc(72ch+3rem)]' : ''"
    >
      <input
        ref="titleInput"
        v-model="title"
        type="text"
        maxlength="500"
        placeholder="Titre"
        aria-label="Titre de la note"
        class="min-w-24 flex-1 bg-transparent text-[26px] font-semibold text-note placeholder:text-muted"
        :readonly="inTrash"
        @input="titleSave.touch()"
        @keydown.enter.prevent="onTitleEnter"
      />
      <template v-if="!inTrash">
        <!-- May shrink (its text is cut) so that a narrow window keeps room for the title. -->
        <UiSelect
          v-if="note.kind === 'code'"
          label="Langage"
          :model-value="normalizeLanguage(note.codeLanguage) ?? 'plaintext'"
          :options="languageOptions"
          @update:model-value="setLanguage"
        />
        <FuseTimeLeft
          v-if="note.destroyAt !== null"
          long
          :destroy-at="note.destroyAt"
          class="min-w-0 truncate pl-1 text-sm"
        />
        <button
          type="button"
          class="rounded-button p-2 hover:bg-surface-2"
          :class="fuseLit ? '' : 'text-muted hover:text-text'"
          :aria-label="fuseLit ? 'Éteindre la mèche' : 'Allumer la mèche'"
          :title="fuseLit ? 'Éteindre la mèche (Ctrl+Maj+E)' : 'Allumer la mèche (Ctrl+Maj+E)'"
          :aria-pressed="fuseLit"
          @click="toggleFuse"
        >
          <FuseIcon :lit="fuseLit" />
        </button>
        <button
          type="button"
          class="rounded-button p-2 hover:bg-surface-2"
          :class="note.pinned ? 'text-note' : 'text-muted hover:text-text'"
          :aria-label="note.pinned ? 'Désépingler' : 'Épingler'"
          :title="note.pinned ? 'Désépingler (Ctrl+P)' : 'Épingler (Ctrl+P)'"
          :aria-pressed="note.pinned"
          @click="togglePin"
        >
          <PinOff v-if="note.pinned" :size="18" aria-hidden="true" />
          <Pin v-else :size="18" aria-hidden="true" />
        </button>
        <NoteMenu
          ref="menu"
          :kind="note.kind"
          :color="note.color"
          :wrap="settings.codeLineWrap"
          @color="setColor"
          @convert="convert"
          @copy="copyMarkdown"
          @toggle-wrap="toggleWrap"
          @trash="moveToTrash"
        />
      </template>
    </header>

    <div
      v-if="inTrash"
      class="mx-6 mb-3 flex self-center w-[calc(100%-3rem)] max-w-[72ch] flex-wrap items-center gap-2 rounded-button border border-border bg-surface px-3 py-2 text-sm"
      role="status"
    >
      <span class="min-w-56 flex-1 text-text">
        {{
          exploded
            ? "Sa mèche a brûlé : cette note est dans la corbeille."
            : "Cette note est dans la corbeille."
        }}
      </span>
      <button
        ref="restoreButton"
        type="button"
        class="flex items-center gap-1 rounded-[8px] px-2 py-1 font-semibold text-brand hover:bg-surface-2"
        @click="restore()"
      >
        <RotateCcw :size="15" aria-hidden="true" />
        {{ restoresWithoutFuse ? "Restaurer (la mèche est éteinte)" : "Restaurer" }}
      </button>
      <button
        type="button"
        class="flex items-center gap-1 rounded-[8px] px-2 py-1 font-semibold text-danger hover:bg-surface-2"
        @click="confirmingDelete = true"
      >
        <Trash2 :size="15" aria-hidden="true" />
        Supprimer définitivement
      </button>
    </div>

    <div
      class="min-h-0 flex-1 overflow-y-auto"
      :class="note.kind === 'rich' ? ['px-6', ui.focusMode ? 'pt-10' : ''] : ''"
    >
      <RichEditor
        v-if="note.kind === 'rich'"
        ref="rich"
        :content="note.content"
        :editable="!inTrash"
        @changed="contentSave.touch()"
        @escape="ui.escapeFromNote()"
        @ready="
          (markdown: string) => {
            contentSave.rebase(markdown);
            onEditorReady();
          }
        "
      />
      <CodeEditor
        v-else
        ref="code"
        :content="note.content"
        :language="note.codeLanguage"
        :wrap="settings.codeLineWrap"
        :editable="!inTrash"
        @changed="contentSave.touch()"
        @ready="onEditorReady"
      />
    </div>

    <ConfirmDialog
      :open="confirmingDelete"
      title="Supprimer définitivement ?"
      message="Cette note sera effacée pour de bon, sur tous tes appareils."
      confirm-label="Supprimer"
      @confirm="deleteForever"
      @cancel="confirmingDelete = false"
    />
  </article>
</template>
