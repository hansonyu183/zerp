<script setup lang="ts">
import FieldInput from '../dynamic-fields/FieldInput.vue'
import type { FinancialDraft } from './financial-data.ts'
type Line = FinancialDraft['expenses'][number]
const props = defineProps<{ modelValue: Line; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Line] }>()
function patch(value: Partial<Line>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
</script>
<template>
  <div class="form-stack">
    <FieldInput
      usage="edit"
      :field="{
        key: 'category',
        type: 'text',
        caption: '费用类别',
        maxLength: 200,
      }"
      :model-value="modelValue.category"
      @update:model-value="patch({ category: $event })"
      :disabled="disabled"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'description',
        type: 'textarea',
        caption: '费用说明',
        maxLength: 1000,
      }"
      :model-value="modelValue.description"
      @update:model-value="patch({ description: $event })"
      :disabled="disabled"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'amount',
        type: 'text',
        caption: '费用金额',
        inputMode: 'decimal',
      }"
      :model-value="modelValue.amount"
      @update:model-value="patch({ amount: $event })"
      :disabled="disabled"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'remark',
        type: 'textarea',
        caption: '费用备注',
        maxLength: 1000,
      }"
      :model-value="modelValue.remark"
      @update:model-value="patch({ remark: $event })"
      :disabled="disabled"
    />
  </div>
</template>
