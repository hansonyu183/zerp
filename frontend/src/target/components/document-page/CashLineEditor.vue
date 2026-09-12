<script setup lang="ts">
import FieldInput from '../dynamic-fields/FieldInput.vue'
import VouReference from './VouReference.vue'
import { billOptions, type CashLine, type BillEntity } from './bill-data.ts'
const props = defineProps<{
  modelValue: CashLine
  entity: BillEntity
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: CashLine] }>()
function patch(value: Partial<CashLine>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
</script>
<template>
  <div class="form-stack">
    <VouReference
      entity="fund-account"
      caption="现金资金账户"
      :model-value="modelValue.fundAccount"
      :disabled="disabled"
      @update:model-value="patch({ fundAccount: $event })"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'direction',
        type: 'choice',
        caption: '现金方向',
        options: billOptions('direction').map((option) => ({
          value: option.value,
          caption: option.title,
        })),
      }"
      :model-value="modelValue.direction"
      @update:model-value="patch({ direction: $event })"
      :disabled="disabled"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'amountType',
        type: 'choice',
        caption: '现金类型',
        options: billOptions('amountType').map((option) => ({
          value: option.value,
          caption: option.title,
        })),
      }"
      :model-value="modelValue.amountType"
      @update:model-value="patch({ amountType: $event })"
      :disabled="disabled"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'amount',
        type: 'text',
        caption: '现金金额',
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
        caption: '现金行备注',
        maxLength: 1000,
      }"
      :model-value="modelValue.remark"
      @update:model-value="patch({ remark: $event })"
      :disabled="disabled"
    />
  </div>
</template>
