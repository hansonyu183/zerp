<script setup lang="ts">
import {
  intermediaryCategoryLabels,
  type IntermediaryDraft,
} from './intermediary-data.ts'
defineProps<{ calculation: NonNullable<IntermediaryDraft['calculation']> }>()
</script>
<template>
  <section aria-label="计算结果" class="intermediary-results">
    <p>
      采用脚本：{{ calculation.script.name }} · 第
      {{ calculation.script.revision }} 版
    </p>
    <p>
      签收明细 {{ calculation.source.lines.length }} 条，票据来源
      {{ calculation.source.bills.length }} 条。
    </p>
    <table>
      <thead>
        <tr>
          <th>收款方</th>
          <th>客户</th>
          <th>分类</th>
          <th>金额</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(summary, index) in calculation.result.summaries"
          :key="index"
        >
          <td>{{ summary.payee.name }}</td>
          <td>{{ summary.customer?.name ?? '—' }}</td>
          <td>{{ intermediaryCategoryLabels[summary.category] }}</td>
          <td>{{ summary.amount }}</td>
        </tr>
      </tbody>
    </table>
    <h3>签收计算明细</h3>
    <table>
      <thead>
        <tr>
          <th>签收单</th>
          <th>标准件数</th>
          <th>业务收益</th>
          <th>第三方居间</th>
          <th>票据成本</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="line in calculation.result.lines"
          :key="line.sourceSignoffLineId"
        >
          <td>
            {{
              calculation.source.lines.find(
                (source) =>
                  source.sourceSignoffLineId === line.sourceSignoffLineId,
              )?.signoffDocumentNo
            }}
          </td>
          <td>{{ line.standardPieceQuantity }}</td>
          <td>{{ line.employeeAmount }}</td>
          <td>{{ line.intermediaryAmount }}</td>
          <td>{{ line.billCost }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="!calculation.result.summaries.length">本月无应计金额。</p>
  </section>
</template>

<style scoped>
.intermediary-results {
  overflow-x: auto;
  max-width: 100%;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
}
th,
td {
  text-align: left;
  padding: 8px;
  overflow-wrap: anywhere;
}
</style>
