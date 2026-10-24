<script setup lang="ts">
// Editor of rich notes (docs/05): TipTap, saved as Markdown by the parent through getMarkdown().
import { openUrl } from "@tauri-apps/plugin-opener";
import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { EditorContent, VueNodeViewRenderer, useEditor } from "@tiptap/vue-3";
import { BubbleMenu } from "@tiptap/vue-3/menus";
import { Bold, Code, Italic, Link, Strikethrough, Unlink } from "lucide-vue-next";
import { nextTick, ref, watch } from "vue";
import { SlashCommandExtension } from "../../editor/SlashCommand";
import { baseCodeBlock, createRichExtensions } from "../../editor/extensions";
import { serializeMarkdown } from "../../editor/serialize";
import { useToastsStore } from "../../stores/toasts";
import CodeBlockView from "./CodeBlockView.vue";

const props = defineProps<{
  /** Markdown of the note, read once when the editor is created (then see `replace`). */
  content: string;
  editable: boolean;
}>();
const emit = defineEmits<{
  changed: [];
  escape: [];
  /** The editor is ready; its own Markdown for the content it was given. */
  ready: [markdown: string];
}>();
const toasts = useToastsStore();

const codeBlockWithToolbar = baseCodeBlock.extend({
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockView);
  },
});

/** Ctrl+click (Cmd+click on macOS) opens a link in the system browser. */
function openLinkOnModifierClick(event: MouseEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  const href = (event.target as HTMLElement | null)?.closest("a")?.getAttribute("href");
  if (!href) return false;
  openUrl(href).catch((error: unknown) => toasts.error("Impossible d'ouvrir ce lien.", error));
  return true;
}

/**
 * Échap is always kept by ProseMirror, so the window never sees it: the parent is told instead
 * (docs/08, back to the list). Lowest priority, so the slash menu closes itself first.
 */
const EscapeKey = Extension.create({
  name: "escapeKey",
  priority: 1,
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        emit("escape");
        return true;
      },
    };
  },
});

const editor = useEditor({
  extensions: createRichExtensions({
    codeBlock: codeBlockWithToolbar,
    extra: [SlashCommandExtension, EscapeKey],
  }),
  content: props.content,
  contentType: "markdown",
  editable: props.editable,
  editorProps: {
    attributes: { class: "rich-editor", "aria-label": "Contenu de la note", spellcheck: "true" },
    handleClick: (_view, _position, event) => openLinkOnModifierClick(event),
  },
  onCreate: ({ editor: created }) => emit("ready", serializeMarkdown(created)),
  onUpdate: () => emit("changed"),
});

watch(
  () => props.editable,
  (editable) => editor.value?.setEditable(editable),
);

// ── Selection menu (desktop): bold, italic, strike, code, link ──
const editingLink = ref(false);
const linkUrl = ref("");
const linkInput = ref<HTMLInputElement | null>(null);

function shouldShowMenu({ editor: current }: { editor: Editor }): boolean {
  return (
    current.isEditable && !current.state.selection.empty && !current.isActive("codeBlock")
  );
}

function toggleMark(mark: "bold" | "italic" | "strike" | "code"): void {
  editor.value?.chain().focus().toggleMark(mark).run();
}

async function startLink(): Promise<void> {
  const current = editor.value;
  if (!current) return;
  if (current.isActive("link")) {
    current.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  linkUrl.value = "";
  editingLink.value = true;
  await nextTick();
  linkInput.value?.focus();
}

function applyLink(): void {
  const url = linkUrl.value.trim();
  editingLink.value = false;
  if (!url) {
    editor.value?.commands.focus();
    return;
  }
  const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  editor.value?.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

function cancelLink(): void {
  editingLink.value = false;
  editor.value?.commands.focus();
}

/** The document for `markdown`, as the editor reads it. An empty text gives an empty paragraph,
 * like a new editor: a document needs at least one block. */
function documentFor(current: Editor, markdown: string): ProseMirrorNode {
  const parsed = current.schema.nodeFromJSON(current.markdown!.parse(markdown));
  return parsed.childCount > 0 ? parsed : current.schema.topNodeType.createAndFill()!;
}

defineExpose({
  getMarkdown: (): string => (editor.value ? serializeMarkdown(editor.value) : props.content),
  // null keeps the caret where it is (a fresh editor has it at the start).
  focus: (position: "start" | "end" | null = "start") => editor.value?.commands.focus(position),
  /**
   * Shows another version of the note in place (docs/04: brought by the sync). Only the part
   * that differs is replaced, so ProseMirror maps the caret and the selection through the
   * change: they follow the text around it, and the focus and the scroll stay. Not undoable
   * (Ctrl+Z never brings back the version replaced) and not reported as `changed`. Returns the
   * editor's own Markdown for it.
   */
  replace: (markdown: string): string => {
    const current = editor.value;
    if (!current?.markdown) return markdown;
    const { state, view } = current;
    const next = documentFor(current, markdown);
    const start = state.doc.content.findDiffStart(next.content);
    // `null`: the same document, nothing to replace.
    if (start === null) return serializeMarkdown(current);
    let transaction = state.tr;
    const end = state.doc.content.findDiffEnd(next.content);
    if (end !== null) {
      let { a: endOld, b: endNew } = end;
      // Repeated text can make the end found before the start: move both ends after it.
      const overlap = start - Math.min(endOld, endNew);
      if (overlap > 0) {
        endOld += overlap;
        endNew += overlap;
      }
      // A raw step, not `tr.replace`: the slice comes from a document of the same shape, and
      // `tr.replace` would try to "fit" it, which splits a table when a cell changes.
      transaction.maybeStep(new ReplaceStep(start, endOld, next.slice(start, endNew)));
    }
    if (!transaction.doc.eq(next)) {
      // Safety net: the whole document, the caret kept at the nearest place.
      const { from } = state.selection;
      transaction = state.tr.replaceWith(0, state.doc.content.size, next.content);
      const position = Math.min(from, transaction.doc.content.size);
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(position)));
    }
    view.dispatch(transaction.setMeta("addToHistory", false).setMeta("preventUpdate", true));
    return serializeMarkdown(current);
  },
});
</script>

<template>
  <div>
    <BubbleMenu
      v-if="editor"
      :editor="editor"
      :should-show="shouldShowMenu"
      class="flex items-center gap-0.5 rounded-button border border-border bg-surface-2 p-1"
    >
      <form v-if="editingLink" class="flex items-center" @submit.prevent="applyLink">
        <input
          ref="linkInput"
          v-model="linkUrl"
          type="text"
          placeholder="https://…"
          aria-label="Adresse du lien"
          class="w-56 rounded-[8px] bg-bg px-2 py-1 text-sm text-text outline-none"
          @keydown.escape.prevent="cancelLink"
          @blur="cancelLink"
        />
      </form>
      <template v-else>
        <button
          v-for="mark in [
            { name: 'bold', label: 'Gras', icon: Bold },
            { name: 'italic', label: 'Italique', icon: Italic },
            { name: 'strike', label: 'Barré', icon: Strikethrough },
            { name: 'code', label: 'Code', icon: Code },
          ] as const"
          :key="mark.name"
          type="button"
          class="bubble-button"
          :aria-label="mark.label"
          :title="mark.label"
          :aria-pressed="editor.isActive(mark.name)"
          @click="toggleMark(mark.name)"
        >
          <component :is="mark.icon" :size="16" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="bubble-button"
          :aria-label="editor.isActive('link') ? 'Retirer le lien' : 'Lien'"
          :title="editor.isActive('link') ? 'Retirer le lien' : 'Lien'"
          :aria-pressed="editor.isActive('link')"
          @click="startLink"
        >
          <Unlink v-if="editor.isActive('link')" :size="16" aria-hidden="true" />
          <Link v-else :size="16" aria-hidden="true" />
        </button>
      </template>
    </BubbleMenu>
    <EditorContent :editor="editor" />
  </div>
</template>
