<script setup lang="ts">
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import AllocationLineEditor from './AllocationLineEditor.vue'
import ExpenseLineEditor from './ExpenseLineEditor.vue'
import type { DetailFields } from '../details/detail-fields.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { computed } from 'vue'
import { ulid } from 'ulid'
import VouReference from './VouReference.vue'
import {
  financialParty,
  financialPartyOptions,
  financialCategoryOptions,
  isExpense,
  type FinancialDraft,
} from './financial-data.ts'
const props = defineProps<{ modelValue: FinancialDraft; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: FinancialDraft] }>()
const party = computed(() => financialParty(props.modelValue))
const expenses = computed(() => isExpense(props.modelValue.entity))
const mixed = computed(() =>
  ['other-receipt', 'other-payment', 'other-income'].includes(
    props.modelValue.entity,
  ),
)
const partyOptions = computed(() =>
  props.modelValue.entity === 'other-income'
    ? financialPartyOptions.filter(
        (row) => row.value === 'customer-subunit' || row.value === 'supplier',
      )
    : financialPartyOptions,
)
function patch(value: Partial<FinancialDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
const allocationFields = [
  {
    key: 'subunit',
    type: 'group',
    caption: '客户子单位',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  { key: 'amount', type: 'text', caption: '分摊金额' },
] as const satisfies DetailFields<FinancialDraft['allocations'][number]>
const expenseFields = [
  { key: 'category', type: 'text', caption: '费用类别' },
  { key: 'description', type: 'text', caption: '费用说明' },
  { key: 'amount', type: 'text', caption: '费用金额' },
] as const satisfies DetailFields<FinancialDraft['expenses'][number]>
</script>
<template>
  <section class="financial-block form-stack" aria-label="单据事实">
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
    <template v-if="modelValue.entity === 'other-income'">
      <FieldInput
        usage="edit"
        :field="{
          key: 'sourceName',
          type: 'text',
          caption: '来源名称',
          maxLength: 200,
        }"
        :model-value="modelValue.sourceName"
        :disabled="disabled"
        @update:model-value="patch({ sourceName: $event })"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'attachCounterparty',
          type: 'boolean',
          caption: '关联相对方',
        }"
        :model-value="modelValue.attachCounterparty"
        :disabled="disabled"
        @update:model-value="patch({ attachCounterparty: Boolean($event) })"
      />
    </template>
    <template
      v-if="
        modelValue.entity !== 'other-income' || modelValue.attachCounterparty
      "
    >
      <FieldInput
        usage="edit"
        :field="{
          key: 'counterpartyType',
          type: 'choice',
          caption: '相对方类型',
          options: partyOptions.map((option) => ({
            value: option.value,
            caption: option.title,
          })),
        }"
        v-if="mixed"
        :model-value="modelValue.counterpartyType"
        :disabled="disabled"
        @update:model-value="patch({ counterpartyType: $event })"
      />
      <VouReference
        :key="party.entity"
        :entity="party.entity"
        :caption="party.caption"
        :model-value="modelValue.party"
        :disabled="disabled"
        @update:model-value="patch({ party: $event, partyOrigin: 'CURRENT' })"
      />
    </template>
    <FieldInput
      usage="edit"
      :field="{
        key: 'otherCategory',
        type: 'choice',
        caption: '其他类别',
        options: financialCategoryOptions.map((option) => ({
          value: option.value,
          caption: option.title,
        })),
      }"
      v-if="
        modelValue.entity === 'other-receipt' ||
        modelValue.entity === 'other-payment'
      "
      :model-value="modelValue.otherCategory"
      :disabled="disabled"
      @update:model-value="patch({ otherCategory: $event })"
    />
    <VouReference
      v-if="modelValue.entity === 'sales-receipt'"
      entity="operating-entity"
      caption="经营主体"
      :model-value="modelValue.operatingEntity"
      :disabled="disabled"
      @update:model-value="patch({ operatingEntity: $event })"
    />
    <template v-if="!expenses">
      <VouReference
        entity="fund-account"
        caption="资金账户"
        :model-value="modelValue.fundAccount"
        :disabled="disabled"
        @update:model-value="patch({ fundAccount: $event })"
      />
      <VouReference
        entity="employee"
        caption="经办人"
        :model-value="modelValue.handler"
        :disabled="disabled"
        @update:model-value="patch({ handler: $event })"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'amount',
          type: 'text',
          caption: '金额',
          inputMode: 'decimal',
        }"
        :model-value="modelValue.amount"
        :disabled="disabled"
        @update:model-value="patch({ amount: $event })"
      />
    </template>
  </section>
  <CollectionBlock
    v-if="modelValue.entity === 'sales-receipt'"
    caption="分摊行"
    :fields="allocationFields"
    :model-value="modelValue.allocations"
    mode="edit"
    :disabled="disabled"
    :maximum="200"
    :create="
      () => ({
        id: ulid(),
        subunit: null,
        origin: 'CURRENT' as const,
        amount: '',
      })
    "
    @update:model-value="patch({ allocations: $event })"
  >
    <template #editor="{ value, disabled: locked, update }"
      ><AllocationLineEditor
        :model-value="value"
        :disabled="locked"
        @update:model-value="update"
    /></template>
    <template #viewer="{ value }"
      ><AllocationLineEditor :model-value="value" disabled
    /></template>
  </CollectionBlock>
  <CollectionBlock
    v-if="expenses"
    caption="费用行"
    :fields="expenseFields"
    :model-value="modelValue.expenses"
    mode="edit"
    :disabled="disabled"
    :maximum="200"
    :create="
      () => ({
        id: ulid(),
        category: '',
        description: '',
        amount: '',
        remark: '',
      })
    "
    @update:model-value="patch({ expenses: $event })"
  >
    <template #editor="{ value, disabled: locked, update }"
      ><ExpenseLineEditor
        :model-value="value"
        :disabled="locked"
        @update:model-value="update"
    /></template>
    <template #viewer="{ value }"
      ><ExpenseLineEditor :model-value="value" disabled
    /></template>
  </CollectionBlock>
</template>
<style scoped>
.financial-block {
  min-width: 0;
  margin-bottom: 16px;
}
</style>
