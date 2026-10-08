<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import { ulid } from 'ulid'
import { vouPriorLineOriginDocumentPresentation } from '@zerp/model'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import PriorFactBlock from './PriorFactBlock.vue'
import VouReference from './VouReference.vue'
import OrderLineEditor from './OrderLineEditor.vue'
import { fulfillmentFields } from './fulfillment-data.ts'
import type { IndependentReceiptDraft } from './independent-receipt-data.ts'
import type { DetailFields } from '../details/detail-fields.ts'
const props = defineProps<{
  modelValue: IndependentReceiptDraft
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: IndependentReceiptDraft]
  pending: [value: boolean]
  order: []
}>()
function update(patch: Partial<IndependentReceiptDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...patch })
}
const fields = [
  {
    key: 'product',
    type: 'group',
    caption: '产品',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  { key: 'baseQuantity', type: 'text', caption: '基准数量' },
  { key: 'agreedAmount', type: 'text', caption: '实际金额' },
] as const satisfies DetailFields<IndependentReceiptDraft['lines'][number]>
const originFields = [
  {
    key: 'sourceDocumentType',
    type: 'enum',
    caption: '原引用类型',
    required: true,
    options: Object.entries(vouPriorLineOriginDocumentPresentation).map(
      ([value, item]) => ({ value, caption: item.label }),
    ),
  },
  {
    key: 'sourceDocumentKey',
    type: 'text',
    caption: '原引用单据键',
    required: true,
  },
  { key: 'sourceLineKey', type: 'text', caption: '原引用行键', required: true },
] as const
function createLine(): IndependentReceiptDraft['lines'][number] {
  return {
    lineId: ulid(),
    product: null,
    current: null,
    enteredQuantity: '',
    unitId: '',
    baseQuantity: '',
    unitPrice: '',
    agreedAmount: '',
    settlementSurcharge: null,
    remark: '',
    formula: null,
    formulaDraft: null,
    deliverySpecificationType: 'PACKAGED',
    quantityPerContainer: '',
    containerType: '',
    origin: {
      sourceDocumentType: '',
      sourceDocumentKey: '',
      sourceLineKey: '',
    },
  }
}
</script>
<template>
  <section aria-label="独立此前收货录入">
    <p>独立此前收货：保存真实产品、实际金额及原引用，不生成采购订单。</p>
    <v-alert v-if="!modelValue.priorFact" type="info"
      >请明确登记新的此前事实和逐行原引用。复制不沿用原单身份；新业务请先移除商品行，再选择采购订单来源。</v-alert
    >
    <v-btn
      :prepend-icon="actionIcons.edit"
      :disabled="disabled || modelValue.lines.length > 0"
      @click="emit('order')"
      >按采购订单收货</v-btn
    >
    <PriorFactBlock
      entity="purchase-inbound"
      default-source-type="AH"
      :model-value="modelValue.priorFact"
      :disabled="disabled"
      @update:model-value="update({ priorFact: $event })"
    />
    <FormBlock
      :fields="fulfillmentFields"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update"
    />
    <VouReference
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
    <CollectionBlock
      caption="独立收货商品行"
      :fields="fields"
      :model-value="modelValue.lines"
      mode="edit"
      :disabled="disabled"
      :create="createLine"
      @update:model-value="update({ lines: $event })"
      @pending="emit('pending', $event)"
    >
      <template
        #editor="{ value, disabled: locked, update: updateLine, pending }"
      >
        <OrderLineEditor
          :model-value="value"
          entity="purchase-inbound"
          :counterparty="modelValue.supplier"
          :default-surcharge="null"
          :disabled="locked"
          @update:model-value="updateLine({ ...value, ...$event })"
          @pending="pending"
        />
        <FormBlock
          :fields="originFields"
          :model-value="value.origin"
          :disabled="locked"
          @update:model-value="updateLine({ ...value, origin: $event })"
        />
      </template>
      <template #viewer="{ value }">
        <OrderLineEditor
          :model-value="value"
          entity="purchase-inbound"
          :counterparty="modelValue.supplier"
          :default-surcharge="null"
          disabled
        />
        <FormBlock
          :fields="originFields"
          :model-value="value.origin"
          disabled
        />
      </template>
    </CollectionBlock>
  </section>
</template>
