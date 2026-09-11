<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import { shallowRef } from 'vue'
import { productBehaviorLabels, type ProductSnapshot } from './product-data.ts'
import SnapshotReference from '../dynamic-fields/SnapshotReference.vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import ProductUnitsBlock from './ProductUnitsBlock.vue'
import ProductFormulaBlock from './ProductFormulaBlock.vue'
type Details = Pick<
  ProductSnapshot,
  | 'productType'
  | 'productCategory'
  | 'pricingUnit'
  | 'defaultInputUnit'
  | 'unitConversions'
  | 'defaultPackagingSpec'
  | 'recyclable'
  | 'fixedFormula'
>
const props = defineProps<{ modelValue: Details; disabled: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: Details]
  pending: [value: boolean]
}>()
const pendingType = shallowRef<Details['productType'] | null>(null)
function patch(value: Partial<Details>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
function applyType(type: Details['productType']) {
  patch({
    productType: type,
    ...(type.behaviorProfile !== 'STANDARD_FINISHED'
      ? { fixedFormula: null }
      : {}),
    ...(type.behaviorProfile === 'PACKAGING'
      ? { defaultPackagingSpec: '' }
      : { recyclable: false }),
  })
  pendingType.value = null
}
function selectType(
  value: Details['productType'] | Details['productType'][] | null,
) {
  if (!value || Array.isArray(value) || props.disabled) return
  if (
    props.modelValue.productType.id &&
    value.behaviorProfile !== props.modelValue.productType.behaviorProfile &&
    (props.modelValue.fixedFormula ||
      props.modelValue.defaultPackagingSpec ||
      props.modelValue.recyclable)
  )
    pendingType.value = value
  else applyType(value)
}
</script>
<template>
  <SnapshotReference
    source="product-types"
    caption="产品类型"
    :model-value="modelValue.productType"
    :disabled="disabled"
    @update:model-value="selectType"
  />
  <p>
    业务类型：{{
      modelValue.productType.behaviorProfile
        ? productBehaviorLabels[modelValue.productType.behaviorProfile]
        : '未设置'
    }}
  </p>
  <v-alert v-if="pendingType" type="warning"
    >切换产品类型会删除不适用的固定配方、默认包装规格或可回收设置。<v-btn
      :prepend-icon="actionIcons.confirm"
      :disabled="disabled"
      @click="applyType(pendingType)"
      >确认切换</v-btn
    ><v-btn :prepend-icon="actionIcons.cancel" @click="pendingType = null"
      >取消切换</v-btn
    ></v-alert
  ><SnapshotReference
    source="product-categories"
    caption="产品分类"
    :model-value="modelValue.productCategory"
    :disabled="disabled"
    @update:model-value="
      patch({
        productCategory:
          Array.isArray($event) || !$event
            ? { id: '', code: '', name: '' }
            : $event,
      })
    "
  />
  <FormBlock
    v-if="modelValue.productType.behaviorProfile !== 'PACKAGING'"
    :fields="[
      {
        key: 'defaultPackagingSpec',
        type: 'decimal',
        scale: 18,
        caption: '默认包装规格（基准数量）',
      },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="patch($event)"
  /><FormBlock
    v-else
    :fields="[{ key: 'recyclable', type: 'boolean', caption: '可回收包装物' }]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="patch($event)"
  />
  <ProductUnitsBlock
    :model-value="{
      pricingUnit: modelValue.pricingUnit,
      defaultInputUnit: modelValue.defaultInputUnit,
      unitConversions: modelValue.unitConversions,
    }"
    :disabled="disabled"
    @update:model-value="patch($event)"
  />
  <ProductFormulaBlock
    @pending="emit('pending', $event)"
    v-if="modelValue.productType.behaviorProfile === 'STANDARD_FINISHED'"
    :model-value="modelValue.fixedFormula"
    :disabled="disabled"
    @update:model-value="patch({ fixedFormula: $event })"
  />
</template>
