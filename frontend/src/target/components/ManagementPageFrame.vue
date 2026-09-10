<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <v-container fluid class="management-page">
    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-2">
        {{ title }}
        <v-spacer />
        <slot name="actions" />
      </v-card-title>
      <v-card-text>
        <slot name="alerts" />
        <div v-if="$slots.filters" class="management-page__filters">
          <slot name="filters" />
        </div>
        <slot />
        <div v-if="$slots.footer" class="management-page__footer">
          <slot name="footer" />
        </div>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.management-page {
  padding: 24px;
}
.management-page__filters {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(160px, 0.4fr) auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}
.management-page__footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-top: 12px;
}
@media (max-width: 800px) {
  .management-page__filters {
    grid-template-columns: 1fr;
  }
}
</style>
