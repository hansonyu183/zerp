<script setup lang="ts">
import FieldInput from '../dynamic-fields/FieldInput.vue'
import VouReference from './VouReference.vue'
import type { FinancialDraft } from './financial-data.ts'
type Line = FinancialDraft['allocations'][number]
const props = defineProps<{ modelValue: Line; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Line] }>()
function patch(value: Partial<Line>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
</script>
<template>
  <div class="form-stack">
    <VouReference
      entity="customer-subunit"
      caption="客户子单位"
      :model-value="modelValue.subunit"
      :disabled="disabled"
      @update:model-value="patch({ subunit: $event, origin: 'CURRENT' })"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'amount',
        type: 'text',
        caption: '分摊金额',
        inputMode: 'decimal',
      }"
      :model-value="modelValue.amount"
      @update:model-value="patch({ amount: $event })"
      :disabled="disabled"
    />
  </div>
</template>
