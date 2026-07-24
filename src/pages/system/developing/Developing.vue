<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const businessPath = computed(() => {
  const segments = route.path.split('/').filter(Boolean)
  return segments.length >= 2 ? `${segments[0]} / ${segments[1]}` : route.path
})
</script>

<template>
  <v-container class="developing-page">
    <v-icon color="primary" icon="mdi-hammer-wrench" size="64" />
    <h2>开发中...</h2>
    <p>{{ businessPath }}</p>
  </v-container>
</template>

<style scoped>
.developing-page {
  display: grid;
  min-height: 55vh;
  text-align: center;
  place-content: center;
  justify-items: center;
}

h2 {
  margin: 18px 0 6px;
  font-size: clamp(28px, 4vw, 40px);
}

p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 14px;
}
</style>
