<script setup lang="ts">
import { computed, ref } from 'vue'
import { emptyUnit, type ProductSnapshot } from './product-data.ts'
import FormBlock from './FormBlock.vue'
import DetailBlock from './DetailBlock.vue'
import type { DetailDefinition, FormFields } from './form-fields.ts'
type Units = Pick<
  ProductSnapshot,
  'pricingUnit' | 'defaultInputUnit' | 'unitConversions'
>
const props = defineProps<{ modelValue: Units; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Units] }>()
const fields = [
  {
    key: 'pricingUnit',
    type: 'snapshot-reference',
    source: 'product-units',
    caption: '计价单位',
    required: true,
  },
  {
    key: 'defaultInputUnit',
    type: 'snapshot-reference',
    source: 'product-units',
    caption: '默认录入单位',
    required: true,
  },
] as const satisfies FormFields<Units>
const conversions = {
  caption: '单位换算',
  fields: [
    {
      key: 'unit',
      type: 'snapshot-reference',
      source: 'product-units',
      caption: '录入单位',
      required: true,
    },
    {
      key: 'factor',
      type: 'decimal',
      scale: 18,
      caption: '换算系数',
      required: true,
    },
  ],
  empty: { unit: emptyUnit(), factor: '' },
} as const satisfies DetailDefinition<Units['unitConversions'][number]>
const trial = ref({ unitId: '', quantity: '' })
const suggested = computed(() => {
  const a = trial.value.quantity,
    b = props.modelValue.unitConversions.find(
      (item) => item.unit?.id === trial.value.unitId,
    )?.factor
  if (
    !b ||
    a.length > 64 ||
    b.length > 64 ||
    !/^\d+(?:\.\d+)?$/.test(a) ||
    !/^\d+(?:\.\d+)?$/.test(b)
  )
    return ''
  const [integerA, fractionA = ''] = a.split('.'),
    [integerB, fractionB = ''] = b.split('.')
  const scale = fractionA.length + fractionB.length
  const digits = (BigInt(integerA! + fractionA) * BigInt(integerB! + fractionB))
    .toString()
    .padStart(scale + 1, '0')
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
})
</script>
<template>
  <section aria-label="产品单位与试算">
    <FormBlock
      :fields="fields"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event)"
    /><DetailBlock
      :definition="conversions"
      :model-value="modelValue.unitConversions"
      mode="edit"
      :disabled="disabled"
      @update:model-value="
        emit('update:modelValue', { ...modelValue, unitConversions: $event })
      "
    /><v-select
      v-model="trial.unitId"
      label="试算单位"
      :disabled="disabled"
      :items="
        modelValue.unitConversions
          .filter((item) => item.unit?.id)
          .map((item) => ({ value: item.unit.id, title: item.unit.name }))
      "
    /><FormBlock
      :fields="[
        {
          key: 'quantity',
          type: 'decimal',
          scale: 18,
          caption: '试算录入数量',
        },
      ]"
      v-model="trial"
      :disabled="disabled"
    />
    <p>建议基准数量：{{ suggested || '—' }}。实际基准数量由制单人确认。</p>
  </section>
</template>
