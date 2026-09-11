<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import { type IntermediaryDraft } from './intermediary-data.ts'
const props = defineProps<{
  modelValue: IntermediaryDraft
  disabled: boolean
  scriptConfigured: boolean
  canReadScript: boolean
  canSource: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: IntermediaryDraft]
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
  <v-btn
    :prepend-icon="actionIcons.calculate"
    v-if="canReadScript && canSource"
    :disabled="disabled || !scriptConfigured"
    @click="emit('calculate')"
    >重新计算</v-btn
  >
</template>
