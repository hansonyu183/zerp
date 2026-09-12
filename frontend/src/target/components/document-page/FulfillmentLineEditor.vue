<script setup lang="ts">
import SourceLinePicker from './SourceLinePicker.vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import type { FulfillmentDraft } from './fulfillment-data.ts'
type Line = FulfillmentDraft['lines'][number]
const props = defineProps<{
  modelValue: Line
  entity: FulfillmentDraft['entity']
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Line] }>()
function update(value: Partial<Line>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
</script>
<template>
  <div class="form-stack">
    <SourceLinePicker
      :entity="entity"
      :model-value="modelValue.source"
      :disabled="disabled"
      @update:model-value="update({ source: $event })"
    />
    <FormBlock
      :fields="[
        {
          key: 'baseQuantity',
          type: 'decimal',
          scale: 6,
          caption: '基准数量',
          required: true,
        },
        { key: 'remark', type: 'text', caption: '行备注' },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update"
    />
  </div>
</template>
