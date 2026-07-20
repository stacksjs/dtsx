<template>
  <button type="button" :disabled="disabled" @click="onBurn(mint)">
    Burn
  </button>
</template>

<script setup lang="ts">
const props = defineProps<{
  mint: string
  disabled?: boolean
  /**
   * Caller-supplied handler that performs the real burn transaction and
   * resolves with its signature. Required — this component does not build or
   * send transactions itself.
   */
  onBurn: (mint: string) => Promise<string>
}>()
</script>
