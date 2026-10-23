<script setup lang="ts">
// The fuse icon (docs/11): a curved cord ending in a spark. Lucide has none, so it is drawn here.
// Out: the cord alone, in the current text color. Lit: the cord in --fuse, the spark in --spark.
withDefaults(defineProps<{ lit: boolean; size?: number }>(), { size: 18 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      d="M3 21c2.5-.5 4-2.2 4.6-4.6.7-2.6 2.2-4.9 5-6.2"
      stroke="currentColor"
      stroke-width="2"
      :class="lit ? 'text-fuse' : ''"
    />
    <path
      v-if="lit"
      class="text-spark"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="1"
      d="M17.5 3.5l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z"
    />
    <circle v-else cx="13.4" cy="9.8" r="1.3" fill="currentColor" />
  </svg>
</template>
