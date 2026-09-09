<script setup lang="ts">
import { computed } from 'vue'
import { mappingDimensions, mappingFieldOptions } from './vm.ts'
function caption(value: string) {
  if (!(value in mappingDimensions)) throw new Error('未知辅助核算维度')
  return mappingDimensions[value as keyof typeof mappingDimensions]
}
const props = defineProps<{
  fields: string[]
  dimensions: readonly string[]
  disabled?: boolean
}>()
const model = defineModel<Record<string, string>>({ required: true })
const visibleDimensions = computed(() => [
  ...new Set([...props.dimensions, ...Object.keys(model.value)]),
])
function update(key: string, value: string | null) {
  const next = { ...model.value }
  if (value) next[key] = value
  else delete next[key]
  model.value = next
}
</script>
<template>
  <v-select
    v-for="dimension in visibleDimensions"
    :key="dimension"
    :label="`${caption(dimension)}字段${dimensions.includes(dimension) ? '' : '（当前科目不需要，请清除）'}`"
    :items="mappingFieldOptions(fields)"
    :model-value="model[dimension] ?? null"
    :disabled="disabled"
    clearable
    @update:model-value="update(dimension, $event)"
  />
</template>
