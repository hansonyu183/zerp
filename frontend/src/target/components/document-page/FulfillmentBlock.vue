<script setup lang="ts">
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import FulfillmentLineEditor from './FulfillmentLineEditor.vue'
import type { DetailFields } from '../details/detail-fields.ts'
import { ulid } from 'ulid'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import VouReference from './VouReference.vue'
import { fulfillmentFields, type FulfillmentDraft } from './fulfillment-data.ts'
const props = defineProps<{ modelValue: FulfillmentDraft; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: FulfillmentDraft] }>()
function update(patch: Partial<FulfillmentDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...patch })
}
const fields = [
  {
    key: 'source',
    type: 'group',
    caption: '来源行',
    fields: [{ key: 'sourceDocumentNo', type: 'text', caption: '来源单号' }],
  },
  { key: 'baseQuantity', type: 'text', caption: '基准数量' },
  { key: 'remark', type: 'text', caption: '行备注' },
] as const satisfies DetailFields<FulfillmentDraft['lines'][number]>
</script>
<template>
  <FormBlock
    :fields="fulfillmentFields"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <VouReference
    v-if="modelValue.entity !== 'sale-return'"
    entity="supplier"
    caption="供应商"
    :model-value="modelValue.supplier"
    :disabled="disabled"
    @update:model-value="
      update({ supplier: $event, selectionOrigin: 'CURRENT' })
    "
  />
  <VouReference
    entity="warehouse"
    caption="仓库"
    :model-value="modelValue.warehouse"
    :disabled="disabled"
    @update:model-value="update({ warehouse: $event })"
  />
  <FormBlock
    v-if="modelValue.entity !== 'purchase-inbound'"
    :fields="[
      {
        key: 'returnReason',
        type: 'textarea',
        caption: '退货原因',
        required: true,
      },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <CollectionBlock
    caption="来源明细"
    :fields="fields"
    :model-value="modelValue.lines"
    mode="edit"
    :disabled="disabled"
    :create="() => ({ id: ulid(), source: null, baseQuantity: '', remark: '' })"
    @update:model-value="update({ lines: $event })"
  >
    <template #editor="{ value, disabled: locked, update: updateLine }"
      ><FulfillmentLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        :disabled="locked"
        @update:model-value="updateLine"
    /></template>
    <template #viewer="{ value }"
      ><FulfillmentLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        disabled
    /></template>
  </CollectionBlock>
</template>
