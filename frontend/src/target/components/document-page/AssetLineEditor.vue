<script setup lang="ts">
import FieldInput from '../dynamic-fields/FieldInput.vue'
import VouReference, { type VouCandidate } from './VouReference.vue'
import type { AssetEntity, AssetLine } from './asset-data.ts'
const props = defineProps<{
  modelValue: AssetLine
  entity: AssetEntity
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: AssetLine] }>()
function patch(value: Partial<AssetLine>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
function category(value: VouCandidate | null) {
  patch({
    category: value,
    ...(value?.entity === 'asset-category'
      ? {
          usefulLifeMonths:
            props.modelValue.usefulLifeMonths ||
            String(value.defaultUsefulLifeMonths),
          residualRate:
            props.modelValue.residualRate || value.defaultResidualRate,
        }
      : {}),
  })
}
</script>
<template>
  <div class="form-stack">
    <template v-if="entity === 'asset-acquisition'">
      <FieldInput
        usage="edit"
        :field="{
          key: 'assetName',
          type: 'text',
          caption: '资产名称',
          maxLength: 200,
        }"
        :model-value="modelValue.assetName"
        @update:model-value="patch({ assetName: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'specification',
          type: 'text',
          caption: '规格',
          maxLength: 200,
        }"
        :model-value="modelValue.specification"
        @update:model-value="patch({ specification: $event })"
        :disabled="disabled"
      />
      <VouReference
        entity="asset-category"
        caption="资产类别"
        :model-value="modelValue.category"
        :disabled="disabled"
        @update:model-value="category($event)"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'originalValue',
          type: 'text',
          caption: '原值',
          inputMode: 'decimal',
        }"
        :model-value="modelValue.originalValue"
        @update:model-value="patch({ originalValue: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'usefulLifeMonths',
          type: 'text',
          caption: '使用月数',
          inputMode: 'numeric',
        }"
        :model-value="modelValue.usefulLifeMonths"
        @update:model-value="patch({ usefulLifeMonths: $event })"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'residualRate',
          type: 'text',
          caption: '残值率',
          suffix: '%',
          inputMode: 'decimal',
        }"
        :model-value="modelValue.residualRate"
        @update:model-value="patch({ residualRate: $event })"
        :disabled="disabled"
      />
      <VouReference
        entity="department"
        caption="使用部门"
        :model-value="modelValue.department"
        :disabled="disabled"
        @update:model-value="patch({ department: $event })"
      />
      <VouReference
        entity="employee"
        caption="保管人"
        :model-value="modelValue.custodian"
        :disabled="disabled"
        @update:model-value="patch({ custodian: $event })"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'location',
          type: 'text',
          caption: '地点',
          maxLength: 200,
        }"
        :model-value="modelValue.location"
        @update:model-value="patch({ location: $event })"
        :disabled="disabled"
      />
    </template>
    <template v-else>
      <VouReference
        entity="asset"
        caption="在用资产"
        :model-value="modelValue.asset"
        :disabled="disabled"
        @update:model-value="patch({ asset: $event })"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'saleAmount',
          type: 'text',
          caption: '出让金额',
          inputMode: 'decimal',
        }"
        v-if="entity === 'asset-sale'"
        :model-value="modelValue.saleAmount"
        @update:model-value="patch({ saleAmount: $event })"
        :disabled="disabled"
      />
      <template v-else>
        <FieldInput
          usage="edit"
          :field="{
            key: 'reason',
            type: 'textarea',
            caption: '清理原因',
            maxLength: 1000,
          }"
          :model-value="modelValue.reason"
          @update:model-value="patch({ reason: $event })"
          :disabled="disabled"
        />
        <FieldInput
          usage="edit"
          :field="{
            key: 'salvageIncome',
            type: 'text',
            caption: '残值收入',
            inputMode: 'decimal',
          }"
          :model-value="modelValue.salvageIncome"
          @update:model-value="patch({ salvageIncome: $event })"
          :disabled="disabled"
        />
        <FieldInput
          usage="edit"
          :field="{
            key: 'disposalExpense',
            type: 'text',
            caption: '处置费用',
            inputMode: 'decimal',
          }"
          :model-value="modelValue.disposalExpense"
          @update:model-value="patch({ disposalExpense: $event })"
          :disabled="disabled"
        />
      </template>
    </template>
    <FieldInput
      usage="edit"
      :field="{
        key: 'remark',
        type: 'textarea',
        caption: '行备注',
        maxLength: 1000,
      }"
      :model-value="modelValue.remark"
      @update:model-value="patch({ remark: $event })"
      :disabled="disabled"
    />
  </div>
</template>
