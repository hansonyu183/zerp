<script setup lang="ts">
import type { EditorDraft } from './draft.ts'
import OpeningBlock from './OpeningBlock.vue'
import ServiceBlock from './ServiceBlock.vue'
import BillBlock from './BillBlock.vue'
import AssetBlock from './AssetBlock.vue'
import FinancialBlock from './FinancialBlock.vue'
import ProductionBlock from './ProductionBlock.vue'
import ProductFactsBlock from './ProductFactsBlock.vue'
import FulfillmentBlock from './FulfillmentBlock.vue'
import OrderBlock from './OrderBlock.vue'
defineProps<{
  modelValue: Exclude<EditorDraft, { kind: 'intermediary' }>
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Exclude<EditorDraft, { kind: 'intermediary' }>]
  pending: [value: boolean]
}>()
</script>
<template>
  <OpeningBlock
    v-if="modelValue.kind === 'opening'"
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
  <FulfillmentBlock
    v-else-if="modelValue.kind === 'fulfillment'"
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
