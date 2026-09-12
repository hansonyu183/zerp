<script setup lang="ts">
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import BillLineEditor from './BillLineEditor.vue'
import CashLineEditor from './CashLineEditor.vue'
import type { DetailFields } from '../details/detail-fields.ts'
import type { BillLine, CashLine } from './bill-data.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { ulid } from 'ulid'
import VouReference from './VouReference.vue'
import {
  billOptions,
  emptyBillLine,
  emptyCashLine,
  type BillDraft,
} from './bill-data.ts'
const props = defineProps<{ modelValue: BillDraft; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: BillDraft] }>()
function patch(value: Partial<BillDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
const billFields = [
  { key: 'billNo', type: 'text', caption: '票据号码' },
  {
    key: 'bill',
    type: 'group',
    caption: '票据',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  { key: 'currency', type: 'text', caption: '币种' },
  { key: 'faceAmount', type: 'text', caption: '票面金额' },
] as const satisfies DetailFields<BillLine>
const cashFields = [
  {
    key: 'fundAccount',
    type: 'group',
    caption: '资金账户',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  {
    key: 'direction',
    type: 'enum',
    caption: '方向',
    options: billOptions('direction').map(({ value, title }) => ({
      value,
      caption: title,
    })),
  },
  { key: 'amount', type: 'text', caption: '金额' },
] as const satisfies DetailFields<CashLine>
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
    v-if="modelValue.entity === 'bill-receipt'"
    entity="customer-subunit"
    caption="客户子单位"
    :model-value="modelValue.party"
    :disabled="disabled"
    @update:model-value="patch({ party: $event, origin: 'CURRENT' })"
  />
  <VouReference
    v-if="
      modelValue.entity === 'bill-payment' || modelValue.entity === 'bill-issue'
    "
    entity="supplier"
    caption="供应商"
    :model-value="modelValue.party"
    :disabled="disabled"
    @update:model-value="patch({ party: $event, origin: 'CURRENT' })"
  />
  <VouReference
    v-if="modelValue.entity === 'bill-discount'"
    entity="other-unit"
    caption="贴现相对方"
    :model-value="modelValue.party"
    :disabled="disabled"
    @update:model-value="patch({ party: $event, origin: 'CURRENT' })"
  />
  <VouReference
    v-if="
      modelValue.entity === 'bill-receipt' ||
      modelValue.entity === 'bill-payment'
    "
    entity="employee"
    caption="经办人"
    :model-value="modelValue.handler"
    :disabled="disabled"
    @update:model-value="patch({ handler: $event })"
  />
  <FieldInput
    usage="edit"
    :field="{
      key: 'internalCostRateBps',
      type: 'text',
      caption: '内部客户票据成本率',
      suffix: '基点',
      inputMode: 'numeric',
    }"
    v-if="modelValue.entity === 'bill-receipt'"
    :model-value="modelValue.internalCostRateBps"
    :disabled="disabled"
    @update:model-value="patch({ internalCostRateBps: $event })"
  />
  <template
    v-if="
      modelValue.entity === 'bill-issue' ||
      modelValue.entity === 'bill-discount'
    "
  >
    <FieldInput
      usage="edit"
      :field="{
        key: 'interestMode',
        type: 'choice',
        caption: '计息方式',
        options: billOptions('interestMode').map((option) => ({
          value: option.value,
          caption: option.title,
        })),
      }"
      :model-value="modelValue.interestMode"
      :disabled="disabled"
      @update:model-value="patch({ interestMode: $event })"
    />
    <VouReference
      v-if="modelValue.interestMode === 'THIRD_PARTY_PAYABLE'"
      entity="other-unit"
      caption="计息方"
      :model-value="modelValue.interestParty"
      :disabled="disabled"
      @update:model-value="
        patch({ interestParty: $event, interestOrigin: 'CURRENT' })
      "
    />
  </template>
  <FieldInput
    usage="edit"
    :field="{ key: 'withRecourse', type: 'boolean', caption: '附追索权' }"
    v-if="modelValue.entity === 'bill-discount'"
    :model-value="modelValue.withRecourse"
    :disabled="disabled"
    @update:model-value="patch({ withRecourse: Boolean($event) })"
  />
  <FieldInput
    usage="edit"
    :field="{
      key: 'maturityType',
      type: 'choice',
      caption: '到期类型',
      options: billOptions('maturityType').map((option) => ({
        value: option.value,
        caption: option.title,
      })),
    }"
    v-if="modelValue.entity === 'bill-maturity'"
    :model-value="modelValue.maturityType"
    :disabled="disabled"
    @update:model-value="patch({ maturityType: $event })"
  />
  <CollectionBlock
    caption="票据行"
    :fields="billFields"
    :model-value="modelValue.lines"
    mode="edit"
    :disabled="disabled"
    :maximum="20"
    :create="() => emptyBillLine(ulid(), modelValue.currency)"
    @update:model-value="patch({ lines: $event })"
  >
    <template #editor="{ value, disabled: locked, update }"
      ><BillLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        :disabled="locked"
        @update:model-value="update"
    /></template>
    <template #viewer="{ value }"
      ><BillLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        disabled
    /></template>
  </CollectionBlock>
  <CollectionBlock
    caption="现金行"
    :fields="cashFields"
    :model-value="modelValue.cash"
    mode="edit"
    :disabled="disabled"
    :maximum="20"
    :create="() => emptyCashLine(ulid(), modelValue)"
    @update:model-value="patch({ cash: $event })"
  >
    <template #editor="{ value, disabled: locked, update }"
      ><CashLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        :disabled="locked"
        @update:model-value="update"
    /></template>
    <template #viewer="{ value }"
      ><CashLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        disabled
    /></template>
  </CollectionBlock>
</template>
