<script setup lang="ts">
import { computed } from 'vue'
import type { CustomerSnapshot } from './customer-data.ts'
import { customerCostBasisLabels } from './customer-data.ts'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import DetailBlock from './DetailBlock.vue'
import type { EditFields } from '../dynamic-fields/edit-fields.ts'
type Pricing = CustomerSnapshot['subunits'][number]['pricingPolicy']
type CostInput = {
  name: string
  calculationBasis: 'UNIT_PRICE' | 'ORDER_AMOUNT'
  amount: string
}
const props = defineProps<{ modelValue: Pricing; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Pricing] }>()
const fields = [
  {
    key: 'defaultPremiumUnitPrice',
    type: 'decimal',
    scale: 2,
    caption: '默认加价单价',
  },
  {
    key: 'defaultDiscountUnitPrice',
    type: 'decimal',
    scale: 2,
    caption: '默认优惠单价',
  },
  {
    key: 'thirdPartyIntermediaryFixedUnitCost',
    type: 'decimal',
    scale: 2,
    caption: '第三方居间固定单位成本',
  },
  {
    key: 'thirdPartyIntermediaryVariableUnitCost',
    type: 'decimal',
    scale: 2,
    caption: '第三方居间浮动单位成本',
  },
] as const satisfies EditFields<Pricing>
const costs = computed(() =>
  props.modelValue.costItems.map((item) => ({
    name: item.name,
    calculationBasis: item.calculationBasis,
    amount:
      item.calculationBasis === 'UNIT_PRICE'
        ? item.unitPrice
        : item.orderAmount,
  })),
)
const costDefinition = {
  caption: '成本项',
  fields: [
    { key: 'name', type: 'text', caption: '成本名称', required: true },
    {
      key: 'calculationBasis',
      type: 'enum',
      caption: '计算依据',
      options: Object.entries(customerCostBasisLabels).map(
        ([value, caption]) => ({ value, caption }),
      ),
    },
    {
      key: 'amount',
      type: 'decimal',
      scale: 2,
      caption: '成本单价或每单金额',
      required: true,
    },
  ],
  empty: { name: '', calculationBasis: 'UNIT_PRICE', amount: '0.01' },
} as const satisfies {
  caption: string
  fields: EditFields<CostInput>
  empty: CostInput
}
function updateCosts(value: CostInput[]) {
  emit('update:modelValue', {
    ...props.modelValue,
    costItems: value.map((item) =>
      item.calculationBasis === 'UNIT_PRICE'
        ? {
            name: item.name,
            calculationBasis: item.calculationBasis,
            unitPrice: item.amount,
          }
        : {
            name: item.name,
            calculationBasis: item.calculationBasis,
            orderAmount: item.amount,
          },
    ),
  })
}
</script>
<template>
  <section aria-label="客户定价">
    <h3>定价默认值</h3>
    <FormBlock
      :fields="fields"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event)"
    /><DetailBlock
      :definition="costDefinition"
      :model-value="costs"
      mode="edit"
      :disabled="disabled"
      @update:model-value="updateCosts"
    />
  </section>
</template>
