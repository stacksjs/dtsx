<template>
  <span class="icon-badge">{{ name }}</span>
</template>

<script setup lang="ts">
import type { BadgeKind } from './types'

const props = defineProps<{
  name: string
  kind?: BadgeKind
  count?: number
}>()
</script>
