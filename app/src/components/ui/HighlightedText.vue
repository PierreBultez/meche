<script setup lang="ts">
// Shows a search excerpt with its matches highlighted. The text is split on the markers sent by
// Rust and rendered as text nodes: note content is never interpreted as HTML.
import { computed } from "vue";
import { MATCH_END, MATCH_START } from "../../types/note";

const props = defineProps<{ text: string }>();

const parts = computed(() => {
  const result: Array<{ text: string; match: boolean }> = [];
  for (const [index, chunk] of props.text.split(MATCH_START).entries()) {
    if (index === 0) {
      if (chunk) result.push({ text: chunk, match: false });
      continue;
    }
    const [matched, ...rest] = chunk.split(MATCH_END);
    if (matched) result.push({ text: matched, match: true });
    const after = rest.join("");
    if (after) result.push({ text: after, match: false });
  }
  return result;
});
</script>

<template>
  <span>
    <template v-for="(part, index) in parts" :key="index">
      <mark v-if="part.match" class="rounded-[3px] bg-transparent font-semibold text-inherit underline decoration-2 underline-offset-2">{{ part.text }}</mark>
      <template v-else>{{ part.text }}</template>
    </template>
  </span>
</template>
