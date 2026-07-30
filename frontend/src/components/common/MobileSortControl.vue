<script setup lang="ts">
export interface MobileSortOption {
  title: string
  value: string
}

defineOptions({ name: 'MobileSortControl' })

defineProps<{
  field: string
  order: 'asc' | 'desc'
  options: readonly MobileSortOption[]
}>()

const emit = defineEmits<{
  change: [value: { field: string; order: 'asc' | 'desc' }]
}>()
</script>

<template>
  <div class="mobile-sort-control">
    <v-select
      density="compact"
      hide-details
      item-title="title"
      item-value="value"
      :items="options"
      label="排序"
      :model-value="field"
      variant="outlined"
      @update:model-value="emit('change', { field: $event, order })"
    />
    <v-btn
      :aria-label="order === 'asc' ? '升序，点击切换降序' : '降序，点击切换升序'"
      :icon="order === 'asc' ? 'mdi-sort-ascending' : 'mdi-sort-descending'"
      variant="outlined"
      @click="
        emit('change', { field, order: order === 'asc' ? 'desc' : 'asc' })
      "
    />
  </div>
</template>

<style scoped>
.mobile-sort-control {
  display: none;
}

@media (max-width: 700px) {
  .mobile-sort-control {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr) auto;
    margin-bottom: 12px;
  }
}
</style>
