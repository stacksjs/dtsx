<script setup lang="ts">
import { coreTeamMembers } from './contributors'
</script>

<template>
  <div class="vp-doc">
    <h2 pb-2 pt-5 font-normal op50>
      Meet The Team
    </h2>
  </div>

  <div grid="~ cols-2 lg:cols-4 gap-x-3 gap-y-20 items-stretch" p-10>
    <TeamMember
      v-for="c of coreTeamMembers"
      :key="c.github"
      :data="c"
      class="flex flex-col items-center text-center  p-4 h-full"
    />
  </div>
</template>
