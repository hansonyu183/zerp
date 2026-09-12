<script setup lang="ts">
import { computed } from 'vue'
import FieldInput from './FieldInput.vue'
import ReferencePicker from './ReferencePicker.vue'
import DateRangeInput from './DateRangeInput.vue'
import type { FieldRange, FilterField } from './types.ts'
const props = defineProps<{
  field: FilterField
  modelValue: unknown
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()
const range = computed<FieldRange<unknown>>(() => {
  const value = props.modelValue
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const range = value as Partial<FieldRange<unknown>>
    return { from: range.from ?? null, to: range.to ?? null }
  }
  return { from: null, to: null }
})
function updateRange(endpoint: 'from' | 'to', value: unknown) {
  if (!props.disabled)
    emit('update:modelValue', {
      ...range.value,
      [endpoint]: value === '' ? null : value,
    })
}
</script>
<template>
  <DateRangeInput
    v-if="field.type === 'date' && field.range"
    :caption="field.caption"
    :model-value="range as FieldRange<string>"
    :disabled="disabled"
    :data-testid="`field-${field.key}`"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <div
    v-else-if="field.range === true"
    class="dynamic-field-range"
    :data-testid="`field-${field.key}`"
  >
    <FieldInput
      v-for="endpoint in ['from', 'to'] as const"
      :key="endpoint"
      :field="{
        ...field,
        range: false,
        caption: `${field.caption}${endpoint === 'from' ? '起' : '止'}`,
      }"
      :model-value="range[endpoint]"
      :disabled="disabled"
      @update:model-value="updateRange(endpoint, $event)"
    />
  </div>
  <ReferencePicker
    v-else-if="field.type === 'reference'"
    :source="
      field.source === 'app/role'
        ? 'roles'
        : field.source === 'bob/supplier'
          ? 'suppliers'
          : 'customer-subunits'
    "
    :caption="field.caption"
    :model-value="(modelValue as string | null) ?? null"
    :existing="[]"
    :multiple="false"
    :disabled="disabled"
    history
    @update:model-value="emit('update:modelValue', $event)"
  />
  <FieldInput
    v-else
    :field="field"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
<style scoped>
.dynamic-field-range {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
</style>
