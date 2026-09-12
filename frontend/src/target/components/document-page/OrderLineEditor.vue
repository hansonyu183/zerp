<script setup lang="ts">
import { onMounted } from 'vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import ProductFormulaBlock from '../version-page/ProductFormulaBlock.vue'
import VouReference from './VouReference.vue'
import type { OrderDraft, OrderLine } from './order-data.ts'
import { useOrderLineEditor } from './order-line-editor.ts'
import { cloneDraft } from '../dynamic-fields/clone-draft.ts'
const props = defineProps<{
  modelValue: OrderLine
  entity: OrderDraft['entity']
  counterparty: OrderDraft['counterparty']
  defaultSurcharge: string | null
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: OrderLine]
  pending: [value: boolean]
}>()
function lineUpdate(_id: string, value: Partial<OrderLine>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
const {
  pending,
  error,
  historyStatus,
  product,
  formula,
  fields,
  formulaPending,
} = useOrderLineEditor({
  context: () => props,
  lines: () => [props.modelValue],
  update: lineUpdate,
  disabled: () => props.disabled,
  defaultSurcharge: () => props.defaultSurcharge,
  onPending: (value) => emit('pending', value),
})
onMounted(() => {
  if (!props.disabled && props.modelValue.product && !props.modelValue.current)
    void product(
      props.modelValue.lineId,
      props.modelValue.product,
      cloneDraft(props.modelValue),
    )
})
</script>
<template>
  <div class="form-stack">
    <v-alert v-if="error" type="error">{{ error }}</v-alert>
    <VouReference
      entity="product"
      caption="产品"
      :model-value="modelValue.product"
      :disabled="disabled"
      @update:model-value="product(modelValue.lineId, $event)"
    />
    <p v-if="historyStatus[modelValue.lineId]">
      {{ historyStatus[modelValue.lineId] }}
    </p>
    <v-progress-linear v-if="pending.has(modelValue.lineId)" indeterminate />
    <FormBlock
      :fields="fields(modelValue)"
      :model-value="modelValue"
      :disabled="disabled || pending.has(modelValue.lineId)"
      @update:model-value="lineUpdate(modelValue.lineId, $event)"
    />
    <template v-if="entity === 'sale-order' && modelValue.current">
      <p
        v-if="
          modelValue.current.data.productType.behaviorProfile === 'RAW_MATERIAL'
        "
      >
        原材料采用自身配方：基准产量 1、自身用量 1，不可编辑。
      </p>
      <ProductFormulaBlock
        v-else-if="
          modelValue.current.data.productType.behaviorProfile !== 'PACKAGING'
        "
        :key="`${modelValue.current.sourceApprovalEntryId}:${modelValue.formula?.sourceDocumentId ?? ''}`"
        :model-value="modelValue.formulaDraft"
        :disabled="disabled"
        @update:model-value="formula(modelValue.lineId, $event)"
        @pending="formulaPending(modelValue.lineId, $event)"
      />
    </template>
  </div>
</template>
