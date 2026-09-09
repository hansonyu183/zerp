<script setup lang="ts">
import FormBlock from '../version-page/FormBlock.vue'
import {
  intermediaryCategoryLabels,
  type IntermediaryDraft,
  type IntermediaryScriptEditor,
} from './intermediary-data.ts'
const props = defineProps<{
  modelValue: IntermediaryDraft
  script: IntermediaryScriptEditor
  disabled: boolean
  scriptConfigured: boolean
  canReadScript: boolean
  canSaveScript: boolean
  canSource: boolean
  tested: boolean
  scriptUnknown: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: IntermediaryDraft]
  'update:script': [value: IntermediaryScriptEditor]
  loadScript: []
  testScript: []
  saveScript: []
  calculate: []
}>()
function patch(value: Partial<IntermediaryDraft>) {
  if (!props.disabled)
    emit('update:modelValue', {
      ...props.modelValue,
      ...value,
      ...(value.businessDate !== undefined &&
      value.businessDate !== props.modelValue.businessDate
        ? { calculation: null }
        : {}),
    })
}
</script>
<template>
  <FormBlock
    :fields="[
      {
        key: 'businessDate',
        type: 'date',
        caption: '计算月末日期',
        required: true,
      },
      { key: 'remark', type: 'textarea', caption: '备注' },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="patch"
  />
  <p>币种：人民币。计算采用已保存的脚本，历史单据保留当次脚本和结果。</p>
  <v-alert v-if="!scriptConfigured" type="info"
    >尚未配置可用脚本，请先维护、试运行并保存。</v-alert
  >
  <v-alert v-if="!canReadScript" type="warning">缺少读取计算脚本权限。</v-alert>
  <v-alert v-if="!canSource" type="warning">缺少生成计算来源权限。</v-alert>
  <v-alert v-if="scriptUnknown" type="warning"
    >脚本保存结果未知，请重新读取核实。</v-alert
  >
  <v-btn v-if="canReadScript" :disabled="disabled" @click="emit('loadScript')"
    >读取计算脚本</v-btn
  >
  <v-btn
    v-if="canReadScript && canSource"
    :disabled="disabled || !scriptConfigured || scriptUnknown"
    @click="emit('calculate')"
    >重新计算</v-btn
  >
  <section v-if="canSaveScript" aria-label="维护计算脚本">
    <FormBlock
      :fields="[
        { key: 'name', type: 'text', caption: '脚本名称', required: true },
        {
          key: 'source',
          type: 'textarea',
          caption: '计算脚本',
          required: true,
        },
      ]"
      :model-value="script"
      :disabled="disabled || scriptUnknown"
      @update:model-value="emit('update:script', { ...script, ...$event })"
    />
    <p>
      定义同步函数 globalThis.calculate(input)，返回 lines 和
      summaries。脚本只接收本月来源数据。
    </p>
    <v-btn
      v-if="canSource"
      :disabled="disabled || scriptUnknown || !script.source.trim()"
      @click="emit('testScript')"
      >试运行脚本</v-btn
    >
    <v-btn
      :disabled="disabled || scriptUnknown || !tested || !script.name.trim()"
      @click="emit('saveScript')"
      >保存计算脚本</v-btn
    >
    <p v-if="tested">当前脚本试运行成功。保存后需重新计算才能用于提交。</p>
  </section>
  <section
    v-if="modelValue.calculation"
    aria-label="计算结果"
    class="intermediary-results"
  >
    <p>
      采用脚本：{{ modelValue.calculation.script.name }} · 第
      {{ modelValue.calculation.script.revision }} 版
    </p>
    <p>
      签收明细 {{ modelValue.calculation.source.lines.length }} 条，票据来源
      {{ modelValue.calculation.source.bills.length }} 条。
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
          v-for="(summary, index) in modelValue.calculation.result.summaries"
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
          v-for="line in modelValue.calculation.result.lines"
          :key="line.sourceSignoffLineId"
        >
          <td>
            {{
              modelValue.calculation.source.lines.find(
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
    <p v-if="!modelValue.calculation.result.summaries.length">
      本月无应计金额。
    </p>
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
