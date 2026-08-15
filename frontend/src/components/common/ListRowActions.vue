<script setup lang="ts">
import { computed } from 'vue'
import type { ListRowAction } from './list-row-actions'

defineOptions({ name: 'ListRowActions' })

const props = withDefaults(
  defineProps<{
    actions: readonly ListRowAction[]
    loading?: boolean
    label?: string
    moreLabel?: string
    loadingReason?: string
  }>(),
  {
    loading: false,
    label: '行操作',
    moreLabel: '更多操作',
    loadingReason: '正在处理上一项操作，请稍候。',
  },
)

const primaryActions = computed(() => props.actions.slice(0, 3))
const moreActions = computed(() => props.actions.slice(3))

const emit = defineEmits<{ select: [key: string] }>()

function selectAction(event: Event | undefined, key: string): void {
  event?.stopPropagation()
  emit('select', key)
}

function stopEvent(event?: Event): void {
  event?.stopPropagation()
}
</script>

<template>
  <div class="list-row-actions" :aria-label="label">
    <span
      v-for="action in primaryActions"
      :key="action.key"
      class="list-row-actions__primary"
      :title="loading ? loadingReason : action.disabledReason"
    >
      <v-btn
        :aria-label="
          loading || action.disabledReason
            ? `${action.label}：${loading ? loadingReason : action.disabledReason}`
            : action.label
        "
        :color="action.color"
        density="comfortable"
        :disabled="loading || action.disabled"
        variant="text"
        @click="selectAction($event, action.key)"
      >
        <v-icon :icon="action.icon" />
        <span class="list-row-actions__label">{{ action.label }}</span>
      </v-btn>
    </span>
    <v-menu v-if="moreActions.length">
      <template #activator="{ props: activatorProps }">
        <v-btn
          v-bind="activatorProps"
          :aria-label="moreLabel"
          density="comfortable"
          :disabled="loading"
          icon="mdi-dots-vertical"
          :title="loading ? loadingReason : moreLabel"
          variant="text"
          @click="stopEvent"
        />
      </template>
      <v-list density="comfortable">
        <v-list-item
          v-for="action in moreActions"
          :key="action.key"
          :base-color="action.color"
          :disabled="loading || action.disabled"
          :prepend-icon="action.icon"
          :title="action.label"
          :subtitle="action.disabledReason"
          @click="selectAction($event, action.key)"
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

.list-row-actions__primary {
  display: inline-flex;
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
