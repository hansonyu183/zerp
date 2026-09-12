<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import VouReference, { type VouCandidate } from './VouReference.vue'
import type { ProductionMaterial } from './production-data.ts'
import { resolveTargetProduct } from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
const props = defineProps<{
  modelValue: ProductionMaterial
  suggestion: string
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ProductionMaterial]
  pending: [value: boolean]
}>()
const session = useTargetSession(),
  generation = session.generation
let active = true,
  request = 0
const error = ref('')
function update(value: Partial<ProductionMaterial>) {
  if (!props.disabled && active && session.generation === generation)
    emit('update:modelValue', { ...props.modelValue, ...value, edited: true })
}
async function replaceMaterial(choice: VouCandidate | null) {
  if (props.disabled) return
  const currentRequest = ++request
  update({ actual: choice, units: [], unitId: '' })
  emit('pending', Boolean(choice))
  if (!choice) return
  try {
    const current = await resolveTargetProduct(
      choice.objectId,
      'approvalEntryId' in choice ? choice.approvalEntryId : undefined,
    )
    if (
      !active ||
      request !== currentRequest ||
      session.generation !== generation
    )
      return
    if (
      !current.enabled ||
      current.data.productType.behaviorProfile !== 'RAW_MATERIAL'
    )
      throw new Error('请选择有效原材料。')
    update({
      units: current.data.unitConversions.map((item) => item.unit),
      unitId: current.data.defaultInputUnit.id,
    })
  } catch (cause) {
    if (active && request === currentRequest)
      error.value = cause instanceof Error ? cause.message : '材料读取失败。'
  } finally {
    if (active && request === currentRequest) emit('pending', false)
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
    <p>建议基准领料量：{{ suggestion || '待填写有效产量' }}</p>
    <VouReference
      entity="product"
      caption="实际材料"
      :model-value="modelValue.actual"
      :disabled="disabled"
      @update:model-value="replaceMaterial($event)"
    />
    <FormBlock
      :fields="[
        {
          key: 'enteredQuantity',
          type: 'decimal',
          scale: 6,
          caption: '实际领料数量',
          required: true,
        },
        {
          key: 'unitId',
          type: 'enum',
          caption: '领料单位',
          required: true,
          options: modelValue.units.map((unit) => ({
            value: unit.id,
            caption: unit.name,
          })),
        },
        {
          key: 'baseQuantity',
          type: 'decimal',
          scale: 6,
          caption: '实际基准领料量',
          required: true,
        },
        { key: 'adjustmentReason', type: 'textarea', caption: '调整原因' },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update($event)"
    />
  </div>
</template>
