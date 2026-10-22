<script setup lang="ts">
// A code block of a rich note: language selector and « Copier » button in its corner (docs/05).
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from "@tiptap/vue-3";
import { Check, ChevronDown, Copy } from "lucide-vue-next";
import { computed, ref } from "vue";
import { CODE_LANGUAGES, normalizeLanguage } from "../../editor/languages";

const props = defineProps(nodeViewProps);

const rawLanguage = computed(() => (props.node.attrs.language as string | null) ?? null);
/** Languages of the list, plus the block's own one if Mèche does not know it (e.g. ```go). */
const options = computed(() => {
  const raw = rawLanguage.value;
  const known = normalizeLanguage(raw) !== null || raw === null;
  return known ? CODE_LANGUAGES : [...CODE_LANGUAGES, { id: raw, label: raw, aliases: [] }];
});
const language = computed({
  get: () => normalizeLanguage(rawLanguage.value) ?? rawLanguage.value ?? "plaintext",
  set: (value: string) =>
    props.updateAttributes({ language: value === "plaintext" ? null : value }),
});

const copied = ref(false);
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(props.node.textContent);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <NodeViewWrapper class="code-block">
    <div class="code-block-toolbar" contenteditable="false">
      <label class="code-block-language-wrapper">
        <select
          v-model="language"
          class="code-block-language"
          aria-label="Langage du bloc de code"
          :disabled="!editor.isEditable"
        >
          <option v-for="option in options" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
        <ChevronDown :size="12" class="code-block-chevron" aria-hidden="true" />
      </label>
      <button
        type="button"
        class="code-block-copy"
        :aria-label="copied ? 'Copié' : 'Copier le code'"
        :title="copied ? 'Copié' : 'Copier'"
        @click="copy"
      >
        <Check v-if="copied" :size="15" aria-hidden="true" />
        <Copy v-else :size="15" aria-hidden="true" />
      </button>
    </div>
    <pre><NodeViewContent as="code" /></pre>
  </NodeViewWrapper>
</template>
