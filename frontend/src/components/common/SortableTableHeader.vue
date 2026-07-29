<script setup lang="ts">
defineOptions({ name: 'SortableTableHeader' })

withDefaults(
  defineProps<{
    label: string
    active?: boolean
    direction?: 'asc' | 'desc'
    align?: 'start' | 'center' | 'end'
    width?: string
  }>(),
  {
    active: false,
    direction: 'asc',
    align: 'start',
    width: undefined,
  },
)

defineEmits<{ sort: [] }>()
</script>

<template>
  <th
    :aria-sort="
      active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
    "
    :class="['sortable-table-header', `text-${align}`]"
    :style="{ width }"
    tabindex="0"
    @click="$emit('sort')"
    @keydown.enter.prevent="$emit('sort')"
    @keydown.space.prevent="$emit('sort')"
  >
    <span class="sortable-table-header__content">
      <span>{{ label }}</span>
      <v-icon
        :class="{ 'sortable-table-header__icon--inactive': !active }"
        :icon="
          !active
            ? 'mdi-swap-vertical'
            : direction === 'desc'
              ? 'mdi-arrow-down'
              : 'mdi-arrow-up'
        "
        size="16"
      />
    </span>
  </th>
</template>

<style scoped>
.sortable-table-header {
  cursor: pointer;
  font-weight: 600;
}

.sortable-table-header__content {
  align-items: center;
  display: inline-flex;
  gap: 4px;
  min-height: 36px;
}

.sortable-table-header:focus-visible {
  border-radius: 4px;
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -3px;
}

.sortable-table-header__icon--inactive {
  opacity: 0.3;
}
</style>
