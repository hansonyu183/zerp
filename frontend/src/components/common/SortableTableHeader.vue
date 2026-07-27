<script setup lang="ts">
defineOptions({ name: 'SortableTableHeader' })

withDefaults(defineProps<{
  label: string
  active?: boolean
  direction?: 'asc' | 'desc'
  align?: 'start' | 'center' | 'end'
  width?: string
}>(), {
  active: false,
  direction: 'asc',
  align: 'start',
  width: undefined,
})

defineEmits<{ sort: [] }>()
</script>

<template>
  <th
    :aria-sort="active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'"
    :class="`text-${align}`"
    :style="{ width }"
  >
    <button
      class="sortable-table-header"
      type="button"
      @click="$emit('sort')"
    >
      <span>{{ label }}</span>
      <v-icon
        :class="{ 'sortable-table-header__icon--inactive': !active }"
        :icon="active && direction === 'desc' ? 'mdi-arrow-down' : 'mdi-arrow-up'"
        size="16"
      />
    </button>
  </th>
</template>

<style scoped>
.sortable-table-header {
  align-items: center;
  color: inherit;
  display: inline-flex;
  font: inherit;
  font-weight: 600;
  gap: 4px;
  min-height: 36px;
}
.sortable-table-header:focus-visible {
  border-radius: 4px;
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.sortable-table-header__icon--inactive { opacity: 0.3; }
</style>
