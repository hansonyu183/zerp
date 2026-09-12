<script setup lang="ts">
import FieldInput from '../dynamic-fields/FieldInput.vue'
import VouReference from './VouReference.vue'
import { billOptions, type BillLine, type BillEntity } from './bill-data.ts'
const props = defineProps<{
  modelValue: BillLine
  entity: BillEntity
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: BillLine] }>()
function patch(value: Partial<BillLine>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
</script>
<template>
  <div class="form-stack">
    <FieldInput
      usage="edit"
      :field="{
        key: 'purpose',
        type: 'choice',
        caption: '票据用途',
        options: billOptions('purpose').map((option) => ({
          value: option.value,
          caption: option.title,
        })),
      }"
      v-if="entity === 'bill-receipt'"
      :model-value="modelValue.purpose"
      @update:model-value="patch({ purpose: $event })"
      :disabled="disabled"
    />
    <template
      v-if="
        entity === 'bill-issue' ||
        (entity === 'bill-receipt' && modelValue.purpose === 'PRIMARY')
      "
    >
      <FieldInput
        usage="edit"
        :field="{
          key: 'billType',
          type: 'choice',
          caption: '票据种类',
          options: billOptions('billType').map((option) => ({
            value: option.value,
            caption: option.title,
          })),
        }"
        :model-value="modelValue.billType"
        @update:model-value="patch({ billType: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'billNo',
          type: 'text',
          caption: '票据号码',
          maxLength: 200,
        }"
        :model-value="modelValue.billNo"
        @update:model-value="patch({ billNo: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'medium',
          type: 'choice',
          caption: '票据介质',
          options: billOptions('medium').map((option) => ({
            value: option.value,
            caption: option.title,
          })),
        }"
        :model-value="modelValue.medium"
        @update:model-value="patch({ medium: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'currency',
          type: 'text',
          caption: '票据币种',
          maxLength: 3,
        }"
        :model-value="modelValue.currency"
        @update:model-value="patch({ currency: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'faceAmount',
          type: 'text',
          caption: '票面金额',
          inputMode: 'decimal',
        }"
        :model-value="modelValue.faceAmount"
        @update:model-value="patch({ faceAmount: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{ key: 'issueDate', type: 'date', caption: '出票日期' }"
        :model-value="modelValue.issueDate"
        @update:model-value="patch({ issueDate: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{ key: 'maturityDate', type: 'date', caption: '到期日期' }"
        :model-value="modelValue.maturityDate"
        @update:model-value="patch({ maturityDate: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'drawer',
          type: 'text',
          caption: '出票人',
          maxLength: 200,
        }"
        :model-value="modelValue.drawer"
        @update:model-value="patch({ drawer: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'acceptor',
          type: 'text',
          caption: '承兑人',
          maxLength: 200,
        }"
        :model-value="modelValue.acceptor"
        @update:model-value="patch({ acceptor: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'payee',
          type: 'text',
          caption: '收款人',
          maxLength: 200,
        }"
        :model-value="modelValue.payee"
        @update:model-value="patch({ payee: $event })"
        :disabled="disabled"
      />
    </template>
    <VouReference
      v-else
      entity="bill"
      caption="可用票据"
      :model-value="modelValue.bill"
      :disabled="disabled"
      @update:model-value="patch({ bill: $event })"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'annualRateBps',
        type: 'text',
        caption: entity === 'bill-discount' ? '本次贴现年利率' : '票据年利率',
        suffix: '基点',
        inputMode: 'numeric',
      }"
      v-if="
        (entity === 'bill-receipt' && modelValue.purpose === 'PRIMARY') ||
        entity === 'bill-issue' ||
        entity === 'bill-discount'
      "
      :model-value="modelValue.annualRateBps"
      @update:model-value="patch({ annualRateBps: $event })"
      :disabled="disabled"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'remark',
        type: 'textarea',
        caption: '票据行备注',
        maxLength: 1000,
      }"
      :model-value="modelValue.remark"
      @update:model-value="patch({ remark: $event })"
      :disabled="disabled"
    />
  </div>
</template>
