<script setup lang="ts">
import { ref, watch } from "vue";
import type { SlashCommand } from "../../editor/slash-commands";

// The suggestion plugin passes more props (editor, range…): keep them off the DOM.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  items: SlashCommand[];
  command: (item: SlashCommand) => void;
}>();

const selected = ref(0);
watch(
  () => props.items,
  () => (selected.value = 0),
);

function choose(index: number): void {
  const item = props.items[index];
  if (item) props.command(item);
}

/** Called by the suggestion plugin; returns true when the key was used by the menu. */
function onKeyDown(event: KeyboardEvent): boolean {
  const count = props.items.length;
  if (count === 0) return false;
  if (event.key === "ArrowDown") {
    selected.value = (selected.value + 1) % count;
    return true;
  }
  if (event.key === "ArrowUp") {
    selected.value = (selected.value - 1 + count) % count;
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    choose(selected.value);
    return true;
  }
  return false;
}

defineExpose({ onKeyDown });
</script>

<template>
  <div
    v-if="items.length > 0"
    role="listbox"
    aria-label="Insérer un bloc"
    class="w-56 rounded-button border border-border bg-surface-2 p-1 text-sm"
  >
    <button
      v-for="(item, index) in items"
      :key="item.label"
      type="button"
      role="option"
      :aria-selected="index === selected"
      class="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left"
      :class="index === selected ? 'bg-brand text-on-brand' : 'text-text'"
      @mousedown.prevent="choose(index)"
      @mouseenter="selected = index"
    >
      <component :is="item.icon" :size="16" aria-hidden="true" />
      {{ item.label }}
    </button>
  </div>
</template>
