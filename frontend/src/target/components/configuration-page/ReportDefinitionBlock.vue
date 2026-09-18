<script setup lang="ts">
import FormBlock from '../dynamic-fields/FormBlock.vue'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import ReportParameterBlock from './ReportParameterBlock.vue'
import {
  parameterFields,
  columnFields,
  newParameter,
  newColumn,
} from './report-definition-data.ts'
import type { TargetReportSaveInput } from '../../api.ts'
defineProps<{ disabled: boolean }>()
const model = defineModel<TargetReportSaveInput>({ required: true })
</script>
<template>
  <FormBlock
    :model-value="model"
    :fields="[
      { key: 'name', caption: '名称', type: 'text', required: true },
      { key: 'description', caption: '说明', type: 'textarea' },
      { key: 'enabled', caption: '启用', type: 'boolean' },
      { key: 'sql', caption: 'SQL', type: 'textarea', required: true },
    ]"
    :disabled="disabled"
    @update:model-value="model = $event"
  />
  <CollectionBlock
    caption="参数"
    v-model="model.parameters"
    :fields="parameterFields"
    :mode="disabled ? 'read' : 'edit'"
    :create="newParameter"
  >
    <template #editor="{ value, update, disabled: childDisabled }"
      ><ReportParameterBlock
        :model-value="value"
        :disabled="childDisabled"
        @update:model-value="update"
    /></template>
    <template #viewer="{ value }"
      ><ReportParameterBlock :model-value="value" disabled
    /></template>
  </CollectionBlock>
  <CollectionBlock
    caption="结果列"
    v-model="model.columns"
    :fields="columnFields"
    :mode="disabled ? 'read' : 'edit'"
    :create="newColumn"
  >
    <template #editor="{ value, update, disabled: childDisabled }"
      ><FormBlock
        :model-value="value"
        :fields="columnFields"
        :disabled="childDisabled"
        @update:model-value="update"
    /></template>
  </CollectionBlock>
</template>
