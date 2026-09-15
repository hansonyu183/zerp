<script setup lang="ts">
import { suggestProductBaseQuantity } from '@zerp/model'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { computed, ref } from 'vue'
import { emptyUnit, type ProductSnapshot } from './product-data.ts'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import { formDetails } from '../dynamic-fields/form-details.ts'
import type {
  DetailDefinition,
  FormFields,
} from '../dynamic-fields/form-fields.ts'
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
    emptyValue: emptyUnit(),
    caption: '计价单位',
    required: true,
  },
  {
    key: 'defaultInputUnit',
    type: 'snapshot-reference',
    source: 'product-units',
    emptyValue: emptyUnit(),
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
      emptyValue: emptyUnit(),
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
  const conversion = props.modelValue.unitConversions.find(
    (item) => item.unit.id === trial.value.unitId,
  )
  return conversion
    ? suggestProductBaseQuantity(trial.value.quantity, conversion)
    : undefined
})
</script>
<template>
  <section aria-label="产品单位与试算">
    <FormBlock
      :fields="fields"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event)"
    /><CollectionBlock
      caption="单位换算"
      :fields="formDetails(conversions.fields)"
      :create="() => ({ unit: emptyUnit(), factor: null })"
      :model-value="modelValue.unitConversions"
      mode="edit"
      :disabled="disabled"
      @update:model-value="
        emit('update:modelValue', { ...modelValue, unitConversions: $event })
      "
    >
      <template #editor="{ value, disabled: locked, update }">
        <FormBlock
          :fields="[conversions.fields[0]]"
          :model-value="value"
          :disabled="locked"
          @update:model-value="
            update({
              ...$event,
              factor: $event.unit.fixedFactor === null ? $event.factor : null,
            })
          "
        />
        <p v-if="value.unit.fixedFactor !== null">
          单位固定系数：{{ value.unit.fixedFactor }}
        </p>
        <FormBlock
          v-else
          :fields="[conversions.fields[1]]"
          :model-value="value"
          :disabled="locked"
          @update:model-value="update"
        />
      </template> </CollectionBlock
    ><FieldInput
      usage="edit"
      :field="{
        key: 'unitId',
        type: 'choice',
        caption: '试算单位',
        options: modelValue.unitConversions
          .filter((item) => item.unit?.id)
          .map((item) => ({ value: item.unit.id, title: item.unit.name }))
          .map((option) => ({ value: option.value, caption: option.title })),
      }"
      v-model="trial.unitId"
      :disabled="disabled"
    /><FormBlock
      :fields="[
        {
          key: 'quantity',
          type: 'decimal',
          scale: 2,
          caption: '试算录入数量',
        },
      ]"
      v-model="trial"
      :disabled="disabled"
    />
    <p>建议基准数量：{{ suggested || '—' }}。实际基准数量由制单人确认。</p>
  </section>
</template>
