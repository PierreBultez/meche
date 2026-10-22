<script setup lang="ts">
// A <select> styled with the tokens (the native one would follow the GTK/Windows theme).
import { ChevronDown } from "lucide-vue-next";

defineOptions({ inheritAttrs: false });
defineProps<{
  modelValue: string;
  options: Array<{ value: string; label: string }>;
  label: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <label class="relative inline-flex min-w-0 items-center" v-bind="$attrs">
    <span class="sr-only">{{ label }}</span>
    <select
      :value="modelValue"
      class="w-full min-w-0 cursor-pointer appearance-none truncate rounded-button bg-surface-2 py-1.5 pl-2.5 pr-7 text-sm text-text hover:ring-1 hover:ring-border"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <ChevronDown
      :size="15"
      class="pointer-events-none absolute right-2 text-muted"
      aria-hidden="true"
    />
  </label>
</template>
