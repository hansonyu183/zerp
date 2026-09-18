<script setup lang="ts">
import { computed } from 'vue'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import { parameterField } from '../report-page/report-data.ts'
import {
  parameterFields,
  referenceTypes,
  reportOptions,
  type ReportParameter,
} from './report-definition-data.ts'
defineProps<{ disabled: boolean }>()
const model = defineModel<ReportParameter>({ required: true })
const enumeration = computed(() =>
  (model.value.enumValues ?? []).map((value) => ({
    value,
    caption: model.value.enumCaptions?.[value] ?? '',
  })),
)
function setEnums(rows: { value: string; caption: string }[]) {
  model.value = {
    ...model.value,
    enumValues: rows.map((row) => row.value),
    enumCaptions: Object.fromEntries(
      rows.map((row) => [row.value, row.caption]),
    ),
  }
}
function update(value: ReportParameter) {
  if (value.type !== model.value.type) {
    delete value.defaultValue
    delete value.enumValues
    delete value.enumCaptions
    delete value.referenceType
  }
  model.value = value
}
function setRange(index: number, value: string) {
  const range = Array.isArray(model.value.defaultValue)
    ? [...model.value.defaultValue]
    : ['', '']
  range[index] = value
  model.value = { ...model.value, defaultValue: range }
}
</script>
<template>
  <FormBlock
    :model-value="model"
    :fields="parameterFields"
    :disabled="disabled"
    @update:model-value="update"
  />
  <FieldInput
    v-if="model.type === 'REFERENCE'"
    :field="{
      key: 'referenceType',
      caption: '引用来源',
      type: 'choice',
      options: reportOptions(referenceTypes),
    }"
    :model-value="model.referenceType"
    :disabled="disabled"
    @update:model-value="model = { ...model, referenceType: $event }"
  />
  <CollectionBlock
    v-if="model.type === 'ENUM'"
    caption="枚举选项"
    :model-value="enumeration"
    :fields="[
      { key: 'value', caption: '值', type: 'text' },
      { key: 'caption', caption: '中文名称', type: 'text' },
    ]"
    :mode="disabled ? 'read' : 'edit'"
    :create="() => ({ value: '', caption: '' })"
    @update:model-value="setEnums"
  >
    <template #editor="{ value, update: updateItem, disabled: itemDisabled }"
      ><FormBlock
        :model-value="value"
        :fields="[
          { key: 'value', caption: '值', type: 'text' },
          { key: 'caption', caption: '中文名称', type: 'text' },
        ]"
        :disabled="itemDisabled"
        @update:model-value="updateItem"
    /></template>
  </CollectionBlock>
  <template v-if="model.type === 'DATE_RANGE'"
    ><FieldInput
      v-for="(caption, index) in ['默认开始日期', '默认结束日期']"
      :key="caption"
      :field="{ key: caption, caption, type: 'date' }"
      :model-value="
        Array.isArray(model.defaultValue) ? model.defaultValue[index] : ''
      "
      :disabled="disabled"
      @update:model-value="setRange(index, $event)"
  /></template>
  <FieldInput
    v-else
    :field="
      model.type === 'REFERENCE'
        ? { key: 'defaultValue', caption: '默认引用标识', type: 'text' }
        : {
            ...parameterField({ ...model, defaultValue: undefined }),
            caption: '默认值',
          }
    "
    :model-value="model.defaultValue"
    :disabled="disabled"
    clearable
    @update:model-value="model = { ...model, defaultValue: $event }"
  />
</template>
