<script setup lang="ts">
defineProps<{
  loading?: boolean
  errorMessage?: string | null
}>()
</script>

<template>
  <v-card rounded="lg" variant="flat">
    <v-progress-linear v-if="loading" indeterminate />
    <v-alert
      v-if="errorMessage"
      class="ma-4 mb-0"
      type="error"
      variant="tonal"
    >
      {{ errorMessage }}
    </v-alert>
    <v-card-title v-if="$slots.header">
      <slot name="header" />
    </v-card-title>
    <v-card-text>
      <slot />
    </v-card-text>
    <v-card-actions v-if="$slots.actions">
      <slot name="actions" />
    </v-card-actions>
  </v-card>
</template>
