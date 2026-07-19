<template>
  <pre>{{ serialized }}</pre>
</template>

<script lang="ts">
export const SERIALIZER_VERSION = 1

export function serialize(value: unknown): string {
  return JSON.stringify(value)
}
</script>

<script setup lang="ts">
const props = defineProps<{
  value: unknown
  pretty?: boolean
}>()
</script>
