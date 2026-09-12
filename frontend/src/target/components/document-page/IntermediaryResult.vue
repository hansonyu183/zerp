<script setup lang="ts">
import { computed } from 'vue'
import DynamicCols from '../dynamic-fields/DynamicCols.vue'
import {
  intermediaryCategoryLabels,
  type IntermediaryDraft,
} from './intermediary-data.ts'
const props = defineProps<{
  calculation: NonNullable<IntermediaryDraft['calculation']>
}>()
const summaries = computed(() =>
  props.calculation.result.summaries.map((row, index) => ({
    displayKey: String(index),
    payee: row.payee.name,
    customer: row.customer?.name ?? null,
    category: row.category,
    amount: row.amount,
  })),
)
const lines = computed(() =>
  props.calculation.result.lines.map((row) => ({
    ...row,
    documentNo:
      props.calculation.source.lines.find(
        (source) => source.sourceSignoffLineId === row.sourceSignoffLineId,
      )?.signoffDocumentNo ?? null,
  })),
)
</script>
<template>
  <section aria-label="计算结果">
    <p>
      采用脚本：{{ calculation.script.name }} · 第
      {{ calculation.script.revision }} 版
    </p>
    <p>
      签收明细 {{ calculation.source.lines.length }} 条，票据来源
      {{ calculation.source.bills.length }} 条。
    </p>
    <DynamicCols
      :fields="[
        { key: 'payee', type: 'text', caption: '收款方' },
        { key: 'customer', type: 'text', caption: '客户' },
        {
          key: 'category',
          type: 'enum',
          caption: '分类',
          options: Object.entries(intermediaryCategoryLabels).map(
            ([value, caption]) => ({ value, caption }),
          ),
        },
        { key: 'amount', type: 'text', caption: '金额' },
      ]"
      :items="summaries"
      identity-key="displayKey"
    />
    <h3>签收计算明细</h3>
    <DynamicCols
      :fields="[
        { key: 'documentNo', type: 'text', caption: '签收单' },
        { key: 'standardPieceQuantity', type: 'text', caption: '标准件数' },
        { key: 'employeeAmount', type: 'text', caption: '业务收益' },
        { key: 'intermediaryAmount', type: 'text', caption: '第三方居间' },
        { key: 'billCost', type: 'text', caption: '票据成本' },
      ]"
      :items="lines"
      identity-key="sourceSignoffLineId"
    />
    <p v-if="!calculation.result.summaries.length">本月无应计金额。</p>
  </section>
</template>
