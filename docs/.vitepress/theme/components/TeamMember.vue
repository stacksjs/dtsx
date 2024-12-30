<script setup lang="ts">
import type { CoreTeam } from './contributors'

defineProps<{
  data: CoreTeam
}>()
</script>

<template>
  <div text-center>
    <img
      loading="lazy"
      width="100" height="100" m-auto h-25 min-h-25 min-w-25 w-25 rounded-full
      :src="data.avatar"
      :alt="`${data.name}'s avatar`"
    >
    <div mb-1 mt-2 text-xl>
      {{ data.name }}
    </div>
    <div h-80px op60 v-html="data.description" />

    <div flex="~ inline gap-2" py2 text-2xl>
      <a
        class="i-carbon-logo-github mya inline-block text-current op30 transition duration-200 hover:op100"
        :href="`https://github.com/${data.github}`"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="`${data.name} on GitHub`"
      />

      <a
        v-if="data.sponsors"
        class="i-carbon-favorite-filled mya inline-block text-current op30 transition duration-200 hover:op100"
        :href="`https://github.com/sponsors/${data.github}`"
        target="_blank"
        rel="noopener noreferrer"
        :title="`Sponsor ${data.name}`"
        :aria-label="`Sponsor ${data.name}`"
      />
    </div>
  </div>
</template>
