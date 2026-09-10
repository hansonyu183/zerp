<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
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
  <section v-for="line in modelValue.lines" :key="line.id" class="bill-line">
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
      v-if="modelValue.entity === 'bill-receipt'"
      v-model="line.purpose"
      :disabled="disabled"
    />
    <template
      v-if="
        modelValue.entity === 'bill-issue' ||
        (modelValue.entity === 'bill-receipt' && line.purpose === 'PRIMARY')
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
        v-model="line.billType"
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
        v-model="line.billNo"
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
        v-model="line.medium"
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
        v-model="line.currency"
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
        v-model="line.faceAmount"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{ key: 'issueDate', type: 'date', caption: '出票日期' }"
        v-model="line.issueDate"
        :disabled="disabled"
      />
      <FieldInput
        usage="edit"
        :field="{ key: 'maturityDate', type: 'date', caption: '到期日期' }"
        v-model="line.maturityDate"
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
        v-model="line.drawer"
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
        v-model="line.acceptor"
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
        v-model="line.payee"
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
    <FieldInput
      usage="edit"
      :field="{
        key: 'annualRateBps',
        type: 'text',
        caption:
          modelValue.entity === 'bill-discount'
            ? '本次贴现年利率'
            : '票据年利率',
        suffix: '基点',
        inputMode: 'numeric',
      }"
      v-if="
        (modelValue.entity === 'bill-receipt' && line.purpose === 'PRIMARY') ||
        modelValue.entity === 'bill-issue' ||
        modelValue.entity === 'bill-discount'
      "
      v-model="line.annualRateBps"
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
      v-model="line.remark"
      :disabled="disabled"
    />
    <v-btn
      :prepend-icon="actionIcons.remove"
      :disabled="disabled"
      @click="
        patch({ lines: modelValue.lines.filter((item) => item.id !== line.id) })
      "
      >移除票据行</v-btn
    >
  </section>
  <v-btn
    :prepend-icon="actionIcons.add"
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
      v-model="line.direction"
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
      v-model="line.amountType"
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
      v-model="line.amount"
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
      v-model="line.remark"
      :disabled="disabled"
    />
    <v-btn
      :prepend-icon="actionIcons.remove"
      :disabled="disabled"
      @click="
        patch({ cash: modelValue.cash.filter((item) => item.id !== line.id) })
      "
      >移除现金行</v-btn
    >
  </section>
  <v-btn
    :prepend-icon="actionIcons.add"
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
