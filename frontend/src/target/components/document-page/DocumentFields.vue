<script setup lang="ts">
import { useTargetSession } from '../../session/vm.ts'
import type { EditorDraft } from './draft.ts'
import InvoiceBlock from './InvoiceBlock.vue'
import OpeningBlock from './OpeningBlock.vue'
import ServiceBlock from './ServiceBlock.vue'
import BillBlock from './BillBlock.vue'
import AssetBlock from './AssetBlock.vue'
import FinancialBlock from './FinancialBlock.vue'
import ProductionBlock from './ProductionBlock.vue'
import ProductFactsBlock from './ProductFactsBlock.vue'
import FulfillmentBlock from './FulfillmentBlock.vue'
import IndependentReceiptBlock from './IndependentReceiptBlock.vue'
import { emptyIndependentReceipt } from './independent-receipt-data.ts'
import { emptyFulfillment } from './fulfillment-data.ts'
import OrderBlock from './OrderBlock.vue'
const props = defineProps<{
  modelValue: Exclude<EditorDraft, { kind: 'intermediary' }>
  disabled: boolean
  action?: 'submit-new' | 'submit-change'
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Exclude<EditorDraft, { kind: 'intermediary' }>]
  pending: [value: boolean]
}>()
const session = useTargetSession()
const canReceipt = (standalone: boolean) =>
  session.canPurchaseInbound(
    props.action ?? 'submit-new',
    standalone ? 'INDEPENDENT_PRIOR' : 'ORDER_REFERENCE',
  )
function switchReceipt(standalone: boolean) {
  const draft = props.modelValue
  if (
    props.disabled ||
    !canReceipt(standalone) ||
    (draft.kind !== 'fulfillment' && draft.kind !== 'independent-receipt') ||
    draft.value.entity !== 'purchase-inbound' ||
    draft.value.lines.length
  )
    return
  const {
    businessDate,
    currency,
    remark,
    supplier,
    selectionOrigin,
    warehouse,
    attachments,
  } = draft.value
  const common = {
    businessDate,
    currency,
    remark,
    supplier,
    selectionOrigin,
    warehouse,
    attachments,
  }
  emit('pending', false)
  emit(
    'update:modelValue',
    standalone
      ? {
          kind: 'independent-receipt',
          value: { ...emptyIndependentReceipt(), ...common },
        }
      : {
          kind: 'fulfillment',
          value: { ...emptyFulfillment('purchase-inbound'), ...common },
        },
  )
}
</script>
<template>
  <InvoiceBlock
    v-if="modelValue.kind === 'invoice'"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'invoice', value: $event })
    "
    @pending="emit('pending', $event)"
  />
  <OpeningBlock
    v-else-if="modelValue.kind === 'opening'"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'opening', value: $event })
    "
  />
  <ServiceBlock
    v-else-if="modelValue.kind === 'service'"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'service', value: $event })
    "
  />
  <BillBlock
    v-else-if="modelValue.kind === 'bill'"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'bill', value: $event })
    "
  />
  <AssetBlock
    v-else-if="modelValue.kind === 'asset'"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'asset', value: $event })
    "
  />
  <FinancialBlock
    v-else-if="modelValue.kind === 'financial'"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'financial', value: $event })
    "
  />
  <ProductionBlock
    v-else-if="modelValue.kind === 'production'"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'production', value: $event })
    "
    @pending="emit('pending', $event)"
  />
  <ProductFactsBlock
    v-else-if="modelValue.kind === 'product-facts'"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'product-facts', value: $event })
    "
    @pending="emit('pending', $event)"
  />
  <IndependentReceiptBlock
    v-else-if="modelValue.kind === 'independent-receipt'"
    :can-switch="canReceipt(false)"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'independent-receipt', value: $event })
    "
    @pending="emit('pending', $event)"
    @order="switchReceipt(false)"
  />
  <FulfillmentBlock
    v-else-if="modelValue.kind === 'fulfillment'"
    :can-switch="canReceipt(true)"
    @standalone="switchReceipt(true)"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'fulfillment', value: $event })
    "
  />
  <OrderBlock
    v-else-if="modelValue.kind === 'order'"
    :model-value="modelValue.value"
    :disabled="disabled"
    @update:model-value="
      emit('update:modelValue', { kind: 'order', value: $event })
    "
    @pending="emit('pending', $event)"
  />
</template>
