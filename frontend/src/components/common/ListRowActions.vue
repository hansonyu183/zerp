<script setup lang="ts">
import type { ListRowAction } from './list-row-actions'

defineOptions({ name: 'ListRowActions' })

withDefaults(
  defineProps<{
    primary?: readonly ListRowAction[]
    more?: readonly ListRowAction[]
    loading?: boolean
    label?: string
    moreLabel?: string
  }>(),
  {
    primary: () => [],
    more: () => [],
    loading: false,
    label: '行操作',
    moreLabel: '更多操作',
  },
)

const emit = defineEmits<{ select: [key: string] }>()
</script>

<template>
  <div class="list-row-actions" :aria-label="label">
    <v-btn
      v-for="action in primary"
      :key="action.key"
      :aria-label="action.label"
      :color="action.color"
      density="comfortable"
      :disabled="loading || action.disabled"
      variant="text"
      @click="emit('select', action.key)"
    >
      <v-icon :icon="action.icon" />
      <span class="list-row-actions__label">{{ action.label }}</span>
    </v-btn>
    <v-menu v-if="more.length">
      <template #activator="{ props: activatorProps }">
        <v-btn
          v-bind="activatorProps"
          :aria-label="moreLabel"
          density="comfortable"
          :disabled="loading"
          icon="mdi-dots-vertical"
          variant="text"
        />
      </template>
      <v-list density="comfortable">
        <v-list-item
          v-for="action in more"
          :key="action.key"
          :base-color="action.color"
          :disabled="loading || action.disabled"
          :prepend-icon="action.icon"
          :title="action.label"
          @click="emit('select', action.key)"
        />
      </v-list>
    </v-menu>
  </div>
</template>

<style scoped>
.list-row-actions {
  align-items: center;
  display: flex;
  justify-content: flex-end;
  white-space: nowrap;
}

.list-row-actions__label {
  display: none;
  margin-inline-start: 6px;
}

@media (max-width: 700px) {
  .list-row-actions {
    flex-wrap: wrap;
    gap: 4px;
    justify-content: flex-end;
    width: 100%;
  }

}
</style>
