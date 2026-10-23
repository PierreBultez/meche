<script setup lang="ts">
// Time left before a note explodes: « 2 j » on a card, « Explose dans 2 j 4 h » in the note.
// Its own component so that only it reads the shared clock: the card around it is not redrawn.
import { computed } from "vue";
import { useNow } from "../../composables/useNow";
import { fuseExplodesIn, fuseIsShort, fuseTimeLeft } from "../../utils/fuse";
import { fullDate } from "../../utils/relative-date";

const props = defineProps<{ destroyAt: number; long?: boolean }>();
const now = useNow();

const text = computed(() =>
  props.long ? fuseExplodesIn(props.destroyAt, now.value) : fuseTimeLeft(props.destroyAt, now.value),
);
const short = computed(() => fuseIsShort(props.destroyAt, now.value));
</script>

<template>
  <time
    :datetime="new Date(destroyAt).toISOString()"
    :title="`Explose le ${fullDate(destroyAt)}`"
    :class="short ? 'text-danger' : 'text-muted'"
  >
    {{ text }}
  </time>
</template>
