<script setup lang="ts">
import { computed } from 'vue'

import { FieldContractError } from './contract.ts'
import type { RowAction } from './types.ts'

const props = defineProps<{
  actions: readonly RowAction[]
}>()

const checkedActions = computed(() => {
  const keys = new Set<string>()
  for (const action of props.actions) {
    for (const key of Object.keys(action))
      if (!['key', 'caption', 'disabled', 'loading', 'color'].includes(key))
        throw new FieldContractError(
          `行操作 ${String(action.key)} 不允许配置 ${key}`,
        )
    if (
      typeof action.key !== 'string' ||
      action.key === '' ||
      typeof action.caption !== 'string' ||
      action.caption === ''
    )
      throw new FieldContractError('行操作必须声明非空 key 和 caption')
    if (action.disabled !== undefined && typeof action.disabled !== 'boolean')
      throw new FieldContractError(
        `行操作 ${action.key} 的 disabled 必须是布尔值`,
      )
    if (action.loading !== undefined && typeof action.loading !== 'boolean')
      throw new FieldContractError(
        `行操作 ${action.key} 的 loading 必须是布尔值`,
      )
    if (
      action.color !== undefined &&
      !['primary', 'success', 'warning', 'error'].includes(action.color)
    )
      throw new FieldContractError(`行操作 ${action.key} 的 color 未登记`)
    if (keys.has(action.key))
      throw new FieldContractError(`行操作 key ${action.key} 重复`)
    keys.add(action.key)
  }
  return props.actions
})

const emit = defineEmits<{
  action: [key: string]
}>()
</script>

<template>
  <div class="row-actions">
    <v-btn
      v-for="action in checkedActions"
      :key="action.key"
      size="small"
      variant="text"
      :color="action.color"
      :loading="action.loading"
      :disabled="action.disabled || action.loading"
      :data-testid="`row-action-${action.key}`"
      @click="emit('action', action.key)"
    >
      {{ action.caption }}
    </v-btn>
  </div>
</template>

<style scoped>
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
