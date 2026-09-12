<script setup lang="ts">
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import AssetLineEditor from './AssetLineEditor.vue'
import type { DetailFields } from '../details/detail-fields.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { ulid } from 'ulid'
import VouReference from './VouReference.vue'
import {
  assetPartyOptions,
  emptyAssetLine,
  type AssetDraft,
  type AssetLine,
} from './asset-data.ts'
const props = defineProps<{ modelValue: AssetDraft; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: AssetDraft] }>()
function patch(value: Partial<AssetDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
const lineFields = [
  { key: 'assetName', type: 'text', caption: '资产名称' },
  {
    key: 'asset',
    type: 'group',
    caption: '资产',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  { key: 'originalValue', type: 'text', caption: '原值' },
  { key: 'remark', type: 'text', caption: '备注' },
] as const satisfies DetailFields<AssetLine>
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
    v-if="modelValue.entity === 'asset-acquisition'"
    entity="supplier"
    caption="供应商"
    :model-value="modelValue.party"
    :disabled="disabled"
    @update:model-value="patch({ party: $event, origin: 'CURRENT' })"
  />
  <template v-if="modelValue.entity === 'asset-sale'">
    <FieldInput
      usage="edit"
      :field="{
        key: 'counterpartyType',
        type: 'choice',
        caption: '相对方类型',
        options: assetPartyOptions.map((option) => ({
          value: option.value,
          caption: option.title,
        })),
      }"
      :model-value="modelValue.counterpartyType"
      :disabled="disabled"
      @update:model-value="patch({ counterpartyType: $event })"
    />
    <VouReference
      :key="modelValue.counterpartyType"
      :entity="modelValue.counterpartyType"
      caption="相对方"
      :model-value="modelValue.party"
      :disabled="disabled"
      @update:model-value="patch({ party: $event, origin: 'CURRENT' })"
    />
  </template>
  <CollectionBlock
    caption="资产行"
    :fields="lineFields"
    :model-value="modelValue.lines"
    mode="edit"
    :disabled="disabled"
    :maximum="200"
    :create="() => emptyAssetLine(ulid())"
    @update:model-value="patch({ lines: $event })"
  >
    <template #editor="{ value, disabled: locked, update }"
      ><AssetLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        :disabled="locked"
        @update:model-value="update"
    /></template>
    <template #viewer="{ value }"
      ><AssetLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        disabled
    /></template>
  </CollectionBlock>
</template>
