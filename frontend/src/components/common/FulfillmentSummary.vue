<script setup lang="ts">
defineProps<{
  labels: readonly string[]
  values: readonly string[]
  unit?: string
  note?: string
}>()
</script>

<template>
  <div class="fulfillment-summary">
    <div class="fulfillment-summary__labels">
      {{ labels.join(' / ') }}
    </div>
    <div class="fulfillment-summary__values">
      {{ values.join(' / ') }}<span v-if="unit"> {{ unit }}</span>
    </div>
    <div v-if="note" class="fulfillment-summary__note">{{ note }}</div>
  </div>
</template>

<style scoped>
.fulfillment-summary {
  min-width: 0;
  line-height: 1.35;
}

.fulfillment-summary__labels {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.78rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.fulfillment-summary__values {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  margin-top: 0.15rem;
  overflow-wrap: anywhere;
}

.fulfillment-summary__note {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.68rem;
  margin-top: 0.1rem;
}
</style>
