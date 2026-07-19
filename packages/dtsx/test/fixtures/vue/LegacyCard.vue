<template>
  <section class="legacy-card">
    <h2>{{ title }}</h2>
    <slot />
  </section>
</template>

<script lang="ts">
import type { PropType } from 'vue'

export default {
  name: 'LegacyCard',
  props: {
    title: { type: String, required: true },
    elevation: { type: Number, default: 1 },
    elevated: Boolean,
    tags: Array as PropType<string[]>,
    meta: Object as PropType<{ author: string }>,
    onClose: Function,
  },
  emits: ['close', 'expand'],
}
</script>
