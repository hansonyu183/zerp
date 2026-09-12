<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import VouReference, { type VouCandidate } from './VouReference.vue'
import { resolveProductFact } from './product-fact-resolution.ts'
import type {
  ProductFactLine,
  ProductFactsDraft,
} from './product-facts-data.ts'
import { useTargetSession } from '../../session/vm.ts'
const props = defineProps<{
  modelValue: ProductFactLine
  entity: ProductFactsDraft['entity']
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ProductFactLine]
  pending: [value: boolean]
}>()
const session = useTargetSession(),
  generation = session.generation
let active = true,
  request = 0
const error = ref('')
function update(value: Partial<ProductFactLine>) {
  if (!props.disabled && active && session.generation === generation)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
async function product(choice: VouCandidate | null) {
  if (props.disabled) return
  const version = ++request
  update({ product: choice, current: null, unitId: '' })
  emit('pending', false)
  if (!choice || props.entity !== 'inventory-count') return
  emit('pending', true)
  try {
    const current = await resolveProductFact(choice)
    if (!active || request !== version || session.generation !== generation)
      return
    update({
      product: {
        entity: 'product',
        objectId: current.objectId,
        approvalEntryId: current.sourceApprovalEntryId,
        code: current.code,
        name: current.data.name,
      },
      current,
      unitId: current.data.defaultInputUnit.id,
    })
  } catch (cause) {
    if (active && request === version)
      error.value = cause instanceof Error ? cause.message : '产品读取失败。'
  } finally {
    if (active && request === version) emit('pending', false)
  }
}
onBeforeUnmount(() => {
  active = false
  request++
  emit('pending', false)
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
      @update:model-value="product($event)"
    />
    <FormBlock
      v-if="entity !== 'inventory-count'"
      :fields="[
        {
          key: 'unitPrice',
          type: 'decimal',
          scale: 2,
          caption: '单价',
          required: true,
        },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update($event)"
    />
    <FormBlock
      v-else
      :fields="[
        {
          key: 'enteredQuantity',
          type: 'decimal',
          scale: 6,
          caption: '实盘数量',
          required: true,
        },
        {
          key: 'unitId',
          type: 'enum',
          caption: '录入单位',
          required: true,
          options:
            modelValue.current?.data.unitConversions.map((item) => ({
              value: item.unit.id,
              caption: item.unit.name,
            })) ?? [],
        },
        {
          key: 'baseQuantity',
          type: 'decimal',
          scale: 6,
          caption: '基准数量',
          required: true,
        },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update($event)"
    />
    <FormBlock
      :fields="[{ key: 'remark', type: 'text', caption: '行备注' }]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update($event)"
    />
  </div>
</template>
