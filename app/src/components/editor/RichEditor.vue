<script setup lang="ts">
// Editor of rich notes (docs/05): TipTap, saved as Markdown by the parent through getMarkdown().
import { openUrl } from "@tauri-apps/plugin-opener";
import { type Editor, Extension } from "@tiptap/core";
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
  /** Markdown of the note, read once when the editor is created. */
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

defineExpose({
  getMarkdown: (): string => (editor.value ? serializeMarkdown(editor.value) : props.content),
  focus: (position: "start" | "end" = "start") => editor.value?.commands.focus(position),
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
