<script setup lang="ts">
// An open note (docs/05, docs/08): header, then the rich or code editor. Mounted again
// (`:key`) whenever the note or its kind changes. A new version brought by the sync is shown in
// place instead (docs/04): the focus, the caret and the scroll stay.
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
import type { CommandError, Note, NoteColor, NotePatch } from "../../types/note";
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

/** What the editor shows: title and text are saved together, by one autosave. */
interface Shown {
  title: string;
  content: string;
}
const sameShown = (a: Shown, b: Shown) => a.title === b.title && a.content === b.content;

/** The text in the editor, which may be newer than the saved one. */
function currentContent(): string {
  return props.note.kind === "rich"
    ? (rich.value?.getMarkdown() ?? props.note.content)
    : (code.value?.getText() ?? props.note.content);
}

/** Where the saves go: this note, or the new note that keeps the text of a deleted one. */
let target = id;
/** A save of this editor was kept elsewhere: said once, until the editor shows the note again. */
let keptElsewhere = false;

function keptMessage(message: string): void {
  if (keptElsewhere) return;
  keptElsewhere = true;
  toasts.show(message);
}

/**
 * Saves what the editor shows. Only the fields changed are sent, with both expected values
 * and the editor's kind: if a field sent changed on another device, Rust keeps the whole
 * version shown here in a single conflict copy (docs/04). Resolves with false when the text
 * was kept elsewhere.
 */
async function writeNote(value: Shown, expected: Shown): Promise<boolean> {
  if (target !== id) return writeAside(value);
  const patch: NotePatch = {
    expectedTitle: expected.title,
    expectedContent: expected.content,
    expectedKind: props.note.kind,
    expectedCodeLanguage: props.note.codeLanguage,
  };
  if (value.title !== expected.title) patch.title = value.title;
  if (value.content !== expected.content) patch.content = value.content;
  let saved: Note;
  try {
    saved = await notes.save(id, patch);
  } catch (error) {
    if ((error as CommandError | undefined)?.kind !== "not_found") throw error;
    // Deleted for good on another device while it was being typed: a new note keeps the
    // text, and the next saves of this editor go to it (never one note per attempt).
    target = (await notes.createAside(props.note.kind)).id;
    keptMessage(
      "Cette note a été supprimée sur un autre appareil. Ce que tu venais d'écrire est gardé dans une nouvelle note.",
    );
    return writeAside(value);
  }
  const applied =
    (patch.title === undefined || saved.title === patch.title) &&
    (patch.content === undefined || saved.content === patch.content);
  if (!applied) {
    keptMessage(
      "Cette note a changé sur un autre appareil. Ce que tu venais d'écrire est gardé dans une copie « (conflit du …) ».",
    );
    // The note holds another version than the one shown here: show it.
    void showStored();
  }
  return applied;
}

/** Saves into the new note that keeps the text of a deleted one: only this editor writes it. */
async function writeAside(value: Shown): Promise<boolean> {
  const language =
    props.note.kind === "code" && props.note.codeLanguage !== null
      ? { codeLanguage: props.note.codeLanguage }
      : {};
  await notes.save(target, { title: value.title, content: value.content, ...language });
  return true;
}

const save = useAutosave<Shown>({
  initial: { title: props.note.title, content: props.note.content },
  read: () => ({ title: title.value, content: currentContent() }),
  same: sameShown,
  write: writeNote,
  onError: saveFailed,
});

const flush = () => save.flush();

/** Replaces the title shown, keeping the caret where it was when the field has the focus. */
function replaceTitle(next: string): void {
  const input = titleInput.value;
  if (title.value === next) return;
  const focused = input !== null && document.activeElement === input;
  const start = input?.selectionStart ?? next.length;
  const end = input?.selectionEnd ?? next.length;
  title.value = next;
  if (focused) {
    void nextTick(() => input.setSelectionRange(Math.min(start, next.length), Math.min(end, next.length)));
  }
}

// The note shown here changed without this editor writing it: the sync brought the version of
// another device (docs/04), or a save of this editor was kept in a copy. What is being typed is
// saved first: since the note changed, Rust does not write it over the new version but keeps it
// in a copy. Then the stored version is shown in place.
let showing = false;
let showAgain = false;
async function showStored(): Promise<void> {
  if (showing) {
    showAgain = true;
    return;
  }
  showing = true;
  try {
    do {
      showAgain = false;
      try {
        await save.flush();
      } catch {
        // Not saved (reported by saveFailed): the text stays on screen rather than being
        // replaced. The next save that succeeds is kept in a copy, and shows the note again.
        return;
      }
      // Typed during the save: saved first, then the stored version is read again. From here
      // on, nothing awaits: nothing can be typed until the new version is shown.
      if (save.pending()) {
        showAgain = true;
        continue;
      }
      const note = props.note;
      if (target !== id) return;
      replaceTitle(note.title);
      let content = note.content;
      if (currentContent() !== note.content) {
        if (note.kind === "rich") content = rich.value?.replace(note.content) ?? note.content;
        else content = code.value?.replace(note.content) ?? note.content;
      }
      save.reset({ title: note.title, content: note.content }, { title: title.value, content });
      keptElsewhere = false;
    } while (showAgain);
  } finally {
    showing = false;
  }
}
watch(
  () => [props.note.title, props.note.content] as const,
  ([noteTitle, noteContent]) => {
    if (!save.knows({ title: noteTitle, content: noteContent })) void showStored();
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
        @input="save.touch()"
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
        @changed="save.touch()"
        @escape="ui.escapeFromNote()"
        @ready="
          (markdown: string) => {
            save.rebase({ title, content: markdown });
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
        @changed="save.touch()"
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
