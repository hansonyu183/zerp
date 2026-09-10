<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { ulid } from 'ulid'
import VouReference, { type VouCandidate } from './VouReference.vue'
import {
  assetPartyOptions,
  emptyAssetLine,
  type AssetDraft,
  type AssetLine,
} from './asset-data.ts'
const props = defineProps<{ modelValue: AssetDraft; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: AssetDraft] }>()
function patch(value: Partial<AssetDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
function category(line: AssetLine, value: VouCandidate | null) {
  if (props.disabled) return
  line.category = value
  if (value?.entity === 'asset-category') {
    if (!line.usefulLifeMonths)
      line.usefulLifeMonths = String(value.defaultUsefulLifeMonths)
    if (!line.residualRate) line.residualRate = value.defaultResidualRate
  }
}
</script>
<template>
  <FieldInput
    usage="edit"
    :field="{ key: 'businessDate', type: 'date', caption: '业务日期' }"
    :model-value="modelValue.businessDate"
    :disabled="disabled"
    @update:model-value="patch({ businessDate: $event })"
  />
  <FieldInput
    usage="edit"
    :field="{ key: 'currency', type: 'text', caption: '币种', maxLength: 3 }"
    :model-value="modelValue.currency"
    :disabled="disabled"
    @update:model-value="patch({ currency: $event })"
  />
  <FieldInput
    usage="edit"
    :field="{
      key: 'remark',
      type: 'textarea',
      caption: '备注',
      maxLength: 1000,
    }"
    :model-value="modelValue.remark"
    :disabled="disabled"
    @update:model-value="patch({ remark: $event })"
  />
  <VouReference
    v-if="modelValue.entity === 'asset-acquisition'"
    entity="supplier"
    caption="供应商"
    :model-value="modelValue.party"
    :disabled="disabled"
    @update:model-value="patch({ party: $event, origin: 'CURRENT' })"
  />
  <template v-if="modelValue.entity === 'asset-sale'">
    <FieldInput
      usage="edit"
      :field="{
        key: 'counterpartyType',
        type: 'choice',
        caption: '相对方类型',
        options: assetPartyOptions.map((option) => ({
          value: option.value,
          caption: option.title,
        })),
      }"
      :model-value="modelValue.counterpartyType"
      :disabled="disabled"
      @update:model-value="patch({ counterpartyType: $event })"
    />
    <VouReference
      :key="modelValue.counterpartyType"
      :entity="modelValue.counterpartyType"
      caption="相对方"
      :model-value="modelValue.party"
      :disabled="disabled"
      @update:model-value="patch({ party: $event, origin: 'CURRENT' })"
    />
  </template>
  <section v-for="line in modelValue.lines" :key="line.id" class="asset-line">
    <template v-if="modelValue.entity === 'asset-acquisition'">
      <FieldInput
        usage="edit"
        :field="{
          key: 'assetName',
          type: 'text',
          caption: '资产名称',
          maxLength: 200,
        }"
        v-model="line.assetName"
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
        v-model="line.specification"
        :disabled="disabled"
      />
      <VouReference
        entity="asset-category"
        caption="资产类别"
        :model-value="line.category"
        :disabled="disabled"
        @update:model-value="category(line, $event)"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'originalValue',
          type: 'text',
          caption: '原值',
          inputMode: 'decimal',
        }"
        v-model="line.originalValue"
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
        v-model="line.usefulLifeMonths"
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
        v-model="line.residualRate"
        :disabled="disabled"
      />
      <VouReference
        entity="department"
        caption="使用部门"
        :model-value="line.department"
        :disabled="disabled"
        @update:model-value="line.department = $event"
      />
      <VouReference
        entity="employee"
        caption="保管人"
        :model-value="line.custodian"
        :disabled="disabled"
        @update:model-value="line.custodian = $event"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'location',
          type: 'text',
          caption: '地点',
          maxLength: 200,
        }"
        v-model="line.location"
        :disabled="disabled"
      />
    </template>
    <template v-else>
      <VouReference
        entity="asset"
        caption="在用资产"
        :model-value="line.asset"
        :disabled="disabled"
        @update:model-value="line.asset = $event"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'saleAmount',
          type: 'text',
          caption: '出让金额',
          inputMode: 'decimal',
        }"
        v-if="modelValue.entity === 'asset-sale'"
        v-model="line.saleAmount"
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
          v-model="line.reason"
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
          v-model="line.salvageIncome"
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
          v-model="line.disposalExpense"
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
      v-model="line.remark"
      :disabled="disabled"
    />
    <v-btn
      :prepend-icon="actionIcons.remove"
      :disabled="disabled"
      @click="
        patch({ lines: modelValue.lines.filter((item) => item.id !== line.id) })
      "
      >移除资产行</v-btn
    >
  </section>
  <v-btn
    :prepend-icon="actionIcons.add"
    :disabled="disabled || modelValue.lines.length >= 200"
    @click="patch({ lines: [...modelValue.lines, emptyAssetLine(ulid())] })"
    >添加资产行</v-btn
  >
</template>
<style scoped>
.asset-line {
  min-width: 0;
  border: 1px solid rgb(var(--v-theme-on-surface), 0.2);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
</style>
