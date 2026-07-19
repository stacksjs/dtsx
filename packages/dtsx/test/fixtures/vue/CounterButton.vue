<template>
  <button type="button" :disabled="disabled" @click="increment">
    {{ label }}: {{ count }}
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  label: string
  disabled?: boolean
  max?: number
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  max: 10,
})

const emit = defineEmits<{
  (e: 'increment', value: number): void
  (e: 'reset'): void
}>()

const count = ref(0)

function increment(): void {
  count.value++
  emit('increment', count.value)
}

defineExpose({
  reset: () => {
    count.value = 0
    emit('reset')
  },
  count,
})
</script>
