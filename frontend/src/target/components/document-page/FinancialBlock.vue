<script setup lang="ts">
import { computed } from 'vue'
import { ulid } from 'ulid'
import VouReference, { type VouCandidate } from './VouReference.vue'
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
function selectSubunit(
  row: FinancialDraft['allocations'][number],
  value: VouCandidate | null,
) {
  if (!props.disabled) {
    row.subunit = value
    row.origin = 'CURRENT'
  }
}
</script>
<template>
  <section class="financial-block" aria-label="单据事实">
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
    <template v-if="modelValue.entity === 'other-income'">
      <v-text-field
        label="来源名称"
        :model-value="modelValue.sourceName"
        :disabled="disabled"
        maxlength="200"
        @update:model-value="patch({ sourceName: $event })"
      />
      <v-checkbox
        label="关联相对方"
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
      <v-select
        v-if="mixed"
        label="相对方类型"
        :items="partyOptions"
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
    <v-select
      v-if="
        modelValue.entity === 'other-receipt' ||
        modelValue.entity === 'other-payment'
      "
      label="其他类别"
      :items="financialCategoryOptions"
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
      <v-text-field
        label="金额"
        inputmode="decimal"
        :model-value="modelValue.amount"
        :disabled="disabled"
        @update:model-value="patch({ amount: $event })"
      />
    </template>
  </section>
  <section
    v-if="modelValue.entity === 'sales-receipt'"
    class="financial-block"
    aria-label="子单位分摊"
  >
    <h3>子单位分摊</h3>
    <div
      v-for="row in modelValue.allocations"
      :key="row.id"
      class="financial-line"
    >
      <VouReference
        entity="customer-subunit"
        caption="客户子单位"
        :model-value="row.subunit"
        :disabled="disabled"
        @update:model-value="selectSubunit(row, $event)"
      />
      <v-text-field
        v-model="row.amount"
        label="分摊金额"
        inputmode="decimal"
        :disabled="disabled"
      />
      <v-btn
        :disabled="disabled"
        @click="
          patch({
            allocations: modelValue.allocations.filter(
              (item) => item.id !== row.id,
            ),
          })
        "
        >删除分摊行</v-btn
      >
    </div>
    <v-btn
      :disabled="disabled || modelValue.allocations.length >= 200"
      @click="
        patch({
          allocations: [
            ...modelValue.allocations,
            { id: ulid(), subunit: null, origin: 'CURRENT', amount: '' },
          ],
        })
      "
      >添加分摊行</v-btn
    >
  </section>
  <section v-if="expenses" class="financial-block" aria-label="费用明细">
    <h3>费用明细</h3>
    <div
      v-for="row in modelValue.expenses"
      :key="row.id"
      class="financial-line"
    >
      <v-text-field
        v-model="row.category"
        label="费用类别"
        maxlength="200"
        :disabled="disabled"
      />
      <v-textarea
        v-model="row.description"
        label="费用说明"
        maxlength="1000"
        :disabled="disabled"
      />
      <v-text-field
        v-model="row.amount"
        label="费用金额"
        inputmode="decimal"
        :disabled="disabled"
      />
      <v-textarea
        v-model="row.remark"
        label="费用备注"
        maxlength="1000"
        :disabled="disabled"
      />
      <v-btn
        :disabled="disabled"
        @click="
          patch({
            expenses: modelValue.expenses.filter((item) => item.id !== row.id),
          })
        "
        >删除费用行</v-btn
      >
    </div>
    <v-btn
      :disabled="disabled || modelValue.expenses.length >= 200"
      @click="
        patch({
          expenses: [
            ...modelValue.expenses,
            {
              id: ulid(),
              category: '',
              description: '',
              amount: '',
              remark: '',
            },
          ],
        })
      "
      >添加费用行</v-btn
    >
  </section>
</template>
<style scoped>
.financial-block {
  min-width: 0;
  margin-bottom: 16px;
}
.financial-line {
  border: 1px solid rgb(var(--v-theme-on-surface), 0.2);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  min-width: 0;
}
</style>
