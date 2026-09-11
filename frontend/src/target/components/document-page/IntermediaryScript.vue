<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import type { IntermediaryScriptEditor } from './intermediary-data.ts'
defineProps<{
  modelValue: IntermediaryScriptEditor
  disabled: boolean
  canReadScript: boolean
  canSaveScript: boolean
  canSource: boolean
  tested: boolean
  scriptUnknown: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: IntermediaryScriptEditor]
  loadScript: []
  testScript: []
  saveScript: []
}>()
</script>
<template>
  <v-alert v-if="scriptUnknown" type="warning"
    >脚本保存结果未知，请重新读取核实。</v-alert
  >
  <v-btn
    :prepend-icon="scriptUnknown ? actionIcons.resolve : actionIcons.view"
    v-if="canReadScript"
    :disabled="disabled"
    @click="emit('loadScript')"
    >读取计算脚本</v-btn
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
      :model-value="modelValue"
      :disabled="disabled || scriptUnknown"
      @update:model-value="
        emit('update:modelValue', { ...modelValue, ...$event })
      "
    />
    <p>
      定义同步函数 globalThis.calculate(input)，返回 lines 和
      summaries。脚本只接收本月来源数据。
    </p>
    <v-btn
      :prepend-icon="actionIcons.trial"
      v-if="canSource"
      :disabled="disabled || scriptUnknown || !modelValue.source.trim()"
      @click="emit('testScript')"
      >试运行脚本</v-btn
    >
    <v-btn
      :prepend-icon="actionIcons.save"
      :disabled="
        disabled || scriptUnknown || !tested || !modelValue.name.trim()
      "
      @click="emit('saveScript')"
      >保存计算脚本</v-btn
    >
    <p v-if="tested">当前脚本试运行成功。保存后需重新计算才能用于提交。</p>
  </section>
</template>
