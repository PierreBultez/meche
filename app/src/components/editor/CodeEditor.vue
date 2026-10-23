<script setup lang="ts">
// Editor of code notes (docs/05): CodeMirror 6, language loaded on demand.
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { codeEditorSetup, loadLanguage } from "../../editor/code-mirror";

const props = defineProps<{
  /** Code of the note, read once when the editor is created (then see `replace`). */
  content: string;
  language: string | null;
  /** Wrap long lines (off by default, toggled from the note menu). */
  wrap: boolean;
  editable: boolean;
}>();
const emit = defineEmits<{ changed: []; ready: [] }>();

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

// A Compartment is a part of the configuration that can be swapped later (language, wrapping…).
const languageSlot = new Compartment();
const wrapSlot = new Compartment();
const editableSlot = new Compartment();

/** Marks the replacements made by `replace`: they are not changes typed here. */
const replaced = Annotation.define<boolean>();

const wrapping = (wrap: boolean) => (wrap ? EditorView.lineWrapping : []);
const editability = (editable: boolean) => [
  EditorState.readOnly.of(!editable),
  EditorView.editable.of(editable),
];

async function applyLanguage(name: string | null): Promise<void> {
  const support = await loadLanguage(name);
  // The note may have changed language again while loading: only apply the latest one.
  if (view && name === props.language) {
    view.dispatch({ effects: languageSlot.reconfigure(support ?? []) });
  }
}

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.content,
      extensions: [
        codeEditorSetup(),
        languageSlot.of([]),
        wrapSlot.of(wrapping(props.wrap)),
        editableSlot.of(editability(props.editable)),
        EditorView.contentAttributes.of({ "aria-label": "Code de la note" }),
        EditorView.updateListener.of((update) => {
          const typed = !update.transactions.some((tr) => tr.annotation(replaced));
          if (update.docChanged && typed) emit("changed");
        }),
      ],
    }),
  });
  void applyLanguage(props.language);
  emit("ready");
});

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});

watch(
  () => props.language,
  (name) => void applyLanguage(name),
);
watch(
  () => props.wrap,
  (wrap) => view?.dispatch({ effects: wrapSlot.reconfigure(wrapping(wrap)) }),
);
watch(
  () => props.editable,
  (editable) => view?.dispatch({ effects: editableSlot.reconfigure(editability(editable)) }),
);

defineExpose({
  getText: (): string => view?.state.doc.toString() ?? props.content,
  focus: () => view?.focus(),
  /**
   * Shows another version of the note in place (docs/04: brought by the sync). Only the part
   * that differs is replaced, so the caret, the selection and the scroll follow the text
   * around it. Not undoable, and not reported as `changed`.
   */
  replace: (text: string): void => {
    if (!view) return;
    const old = view.state.doc.toString();
    let start = 0;
    while (start < old.length && start < text.length && old[start] === text[start]) start++;
    let end = 0;
    while (
      end < old.length - start &&
      end < text.length - start &&
      old[old.length - 1 - end] === text[text.length - 1 - end]
    ) {
      end++;
    }
    view.dispatch({
      changes: { from: start, to: old.length - end, insert: text.slice(start, text.length - end) },
      annotations: [Transaction.addToHistory.of(false), replaced.of(true)],
    });
  },
});
</script>

<template>
  <div ref="host" class="code-editor h-full" />
</template>
