<script setup lang="ts">
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
  <v-text-field
    label="业务日期"
    type="date"
    :model-value="modelValue.businessDate"
    :disabled="disabled"
    @update:model-value="patch({ businessDate: $event })"
  />
  <v-text-field
    label="币种"
    :model-value="modelValue.currency"
    :disabled="disabled"
    maxlength="3"
    @update:model-value="patch({ currency: $event })"
  />
  <v-textarea
    label="备注"
    :model-value="modelValue.remark"
    :disabled="disabled"
    maxlength="1000"
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
    <v-select
      label="相对方类型"
      :items="assetPartyOptions"
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
      <v-text-field
        v-model="line.assetName"
        label="资产名称"
        maxlength="200"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.specification"
        label="规格"
        maxlength="200"
        :disabled="disabled"
      />
      <VouReference
        entity="asset-category"
        caption="资产类别"
        :model-value="line.category"
        :disabled="disabled"
        @update:model-value="category(line, $event)"
      />
      <v-text-field
        v-model="line.originalValue"
        label="原值"
        inputmode="decimal"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.usefulLifeMonths"
        label="使用月数"
        inputmode="numeric"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.residualRate"
        label="残值率"
        suffix="%"
        inputmode="decimal"
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
      <v-text-field
        v-model="line.location"
        label="地点"
        maxlength="200"
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
      <v-text-field
        v-if="modelValue.entity === 'asset-sale'"
        v-model="line.saleAmount"
        label="出让金额"
        inputmode="decimal"
        :disabled="disabled"
      />
      <template v-else>
        <v-textarea
          v-model="line.reason"
          label="清理原因"
          maxlength="1000"
          :disabled="disabled"
        />
        <v-text-field
          v-model="line.salvageIncome"
          label="残值收入"
          inputmode="decimal"
          :disabled="disabled"
        />
        <v-text-field
          v-model="line.disposalExpense"
          label="处置费用"
          inputmode="decimal"
          :disabled="disabled"
        />
      </template>
    </template>
    <v-textarea
      v-model="line.remark"
      label="行备注"
      maxlength="1000"
      :disabled="disabled"
    />
    <v-btn
      :disabled="disabled"
      @click="
        patch({ lines: modelValue.lines.filter((item) => item.id !== line.id) })
      "
      >删除资产行</v-btn
    >
  </section>
  <v-btn
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
