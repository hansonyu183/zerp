<script setup lang="ts">
import { ulid } from 'ulid'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import ProductionLineEditor from './ProductionLineEditor.vue'
import VouReference from './VouReference.vue'
import {
  emptyProductionLine,
  type ProductionDraft,
  type ProductionLine,
} from './production-data.ts'
import type { DetailFields } from '../details/detail-fields.ts'
const props = defineProps<{ modelValue: ProductionDraft; disabled: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: ProductionDraft]
  pending: [value: boolean]
}>()
function update(value: Partial<ProductionDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
const fields = [
  {
    key: 'product',
    type: 'group',
    caption: '成品',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  { key: 'enteredQuantity', type: 'text', caption: '成品数量' },
  { key: 'baseQuantity', type: 'text', caption: '成品基准数量' },
  { key: 'lossRate', type: 'text', caption: '损耗百分比' },
] as const satisfies DetailFields<ProductionLine>
</script>
<template>
  <FormBlock
    :fields="[
      {
        key: 'businessDate',
        type: 'date',
        caption: '业务日期',
        required: true,
      },
      { key: 'remark', type: 'textarea', caption: '备注' },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <VouReference
    entity="warehouse"
    caption="材料仓库"
    :model-value="modelValue.materialWarehouse"
    :disabled="disabled"
    @update:model-value="update({ materialWarehouse: $event })"
  />
  <VouReference
    entity="warehouse"
    caption="成品仓库"
    :model-value="modelValue.finishedWarehouse"
    :disabled="disabled"
    @update:model-value="update({ finishedWarehouse: $event })"
  />
  <CollectionBlock
    caption="成品行"
    :fields="fields"
    :model-value="modelValue.lines"
    mode="edit"
    :disabled="disabled"
    :create="() => emptyProductionLine(ulid())"
    @update:model-value="update({ lines: $event })"
    @pending="emit('pending', $event)"
  >
    <template #editor="{ value, disabled: locked, update: updateLine, pending }"
      ><ProductionLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        :disabled="locked"
        @update:model-value="updateLine"
        @pending="pending"
    /></template>
    <template #viewer="{ value }"
      ><ProductionLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        disabled
    /></template>
  </CollectionBlock>
</template>
