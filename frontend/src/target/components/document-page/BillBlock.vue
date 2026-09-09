<script setup lang="ts">
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
    maxlength="3"
    :disabled="disabled"
    @update:model-value="patch({ currency: $event })"
  />
  <v-textarea
    label="备注"
    :model-value="modelValue.remark"
    maxlength="1000"
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
  <v-text-field
    v-if="modelValue.entity === 'bill-receipt'"
    label="内部客户票据成本率"
    suffix="基点"
    inputmode="numeric"
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
    <v-select
      label="计息方式"
      :items="billOptions('interestMode')"
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
  <v-checkbox
    v-if="modelValue.entity === 'bill-discount'"
    label="附追索权"
    :model-value="modelValue.withRecourse"
    :disabled="disabled"
    @update:model-value="patch({ withRecourse: Boolean($event) })"
  />
  <v-select
    v-if="modelValue.entity === 'bill-maturity'"
    label="到期类型"
    :items="billOptions('maturityType')"
    :model-value="modelValue.maturityType"
    :disabled="disabled"
    @update:model-value="patch({ maturityType: $event })"
  />
  <section v-for="line in modelValue.lines" :key="line.id" class="bill-line">
    <v-select
      v-if="modelValue.entity === 'bill-receipt'"
      v-model="line.purpose"
      label="票据用途"
      :items="billOptions('purpose')"
      :disabled="disabled"
    />
    <template
      v-if="
        modelValue.entity === 'bill-issue' ||
        (modelValue.entity === 'bill-receipt' && line.purpose === 'PRIMARY')
      "
    >
      <v-select
        v-model="line.billType"
        label="票据种类"
        :items="billOptions('billType')"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.billNo"
        label="票据号码"
        maxlength="200"
        :disabled="disabled"
      />
      <v-select
        v-model="line.medium"
        label="票据介质"
        :items="billOptions('medium')"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.currency"
        label="票据币种"
        maxlength="3"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.faceAmount"
        label="票面金额"
        inputmode="decimal"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.issueDate"
        label="出票日期"
        type="date"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.maturityDate"
        label="到期日期"
        type="date"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.drawer"
        label="出票人"
        maxlength="200"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.acceptor"
        label="承兑人"
        maxlength="200"
        :disabled="disabled"
      />
      <v-text-field
        v-model="line.payee"
        label="收款人"
        maxlength="200"
        :disabled="disabled"
      />
    </template>
    <VouReference
      v-else
      entity="bill"
      caption="可用票据"
      :model-value="line.bill"
      :disabled="disabled"
      @update:model-value="line.bill = $event"
    />
    <v-text-field
      v-if="
        (modelValue.entity === 'bill-receipt' && line.purpose === 'PRIMARY') ||
        modelValue.entity === 'bill-issue' ||
        modelValue.entity === 'bill-discount'
      "
      v-model="line.annualRateBps"
      :label="
        modelValue.entity === 'bill-discount' ? '本次贴现年利率' : '票据年利率'
      "
      suffix="基点"
      inputmode="numeric"
      :disabled="disabled"
    />
    <v-textarea
      v-model="line.remark"
      label="票据行备注"
      maxlength="1000"
      :disabled="disabled"
    />
    <v-btn
      :disabled="disabled"
      @click="
        patch({ lines: modelValue.lines.filter((item) => item.id !== line.id) })
      "
      >删除票据行</v-btn
    >
  </section>
  <v-btn
    :disabled="disabled || modelValue.lines.length >= 20"
    @click="
      patch({
        lines: [
          ...modelValue.lines,
          emptyBillLine(ulid(), modelValue.currency),
        ],
      })
    "
    >添加票据行</v-btn
  >
  <section v-for="line in modelValue.cash" :key="line.id" class="bill-line">
    <VouReference
      entity="fund-account"
      caption="现金资金账户"
      :model-value="line.fundAccount"
      :disabled="disabled"
      @update:model-value="line.fundAccount = $event"
    />
    <v-select
      v-model="line.direction"
      label="现金方向"
      :items="billOptions('direction')"
      :disabled="disabled"
    />
    <v-select
      v-model="line.amountType"
      label="现金类型"
      :items="billOptions('amountType')"
      :disabled="disabled"
    />
    <v-text-field
      v-model="line.amount"
      label="现金金额"
      inputmode="decimal"
      :disabled="disabled"
    />
    <v-textarea
      v-model="line.remark"
      label="现金行备注"
      maxlength="1000"
      :disabled="disabled"
    />
    <v-btn
      :disabled="disabled"
      @click="
        patch({ cash: modelValue.cash.filter((item) => item.id !== line.id) })
      "
      >删除现金行</v-btn
    >
  </section>
  <v-btn
    :disabled="disabled || modelValue.cash.length >= 20"
    @click="
      patch({ cash: [...modelValue.cash, emptyCashLine(ulid(), modelValue)] })
    "
    >添加现金行</v-btn
  >
</template>
<style scoped>
.bill-line {
  min-width: 0;
  border: 1px solid rgb(var(--v-theme-on-surface), 0.2);
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
}
</style>
