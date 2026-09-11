<script setup lang="ts">
import { computed } from 'vue'
import type { SupplierData, OtherUnitData, SalesPartnerData } from '@zerp/model'
import type { VersionDefinition } from './definition.ts'
import type { CustomerSnapshot } from './customer-data.ts'
import type { ProductSnapshot } from './product-data.ts'
import type { WflData } from './wfl-data.ts'
import type { EditField, EditValues } from '../dynamic-fields/edit-fields.ts'
import EditForm from '../dynamic-fields/EditForm.vue'
import WflScriptBlock from './WflScriptBlock.vue'
import ProductDetailsEditor from './ProductDetailsEditor.vue'
import CustomerDetailsEditor from './CustomerDetailsEditor.vue'
import IdentityAssociations from './IdentityAssociations.vue'
const props = defineProps<{
  resource: VersionDefinition['resource']
  fields: readonly EditField[]
  modelValue: Record<string, unknown>
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
  pending: [value: boolean]
  submit: []
}>()
function patch(value: object) {
  emit('update:modelValue', { ...props.modelValue, ...value })
}
const customerEditor = computed(() => {
  const {
    defaultOperatingEntity,
    remittanceProfiles,
    identityAttachments,
    subunits,
  } = props.modelValue as unknown as CustomerSnapshot
  return {
    defaultOperatingEntity,
    remittanceProfiles,
    identityAttachments,
    subunits,
  }
})
const productEditor = computed(() => {
  const {
    productType,
    productCategory,
    pricingUnit,
    defaultInputUnit,
    unitConversions,
    defaultPackagingSpec,
    recyclable,
    fixedFormula,
  } = props.modelValue as unknown as ProductSnapshot
  return {
    productType,
    productCategory,
    pricingUnit,
    defaultInputUnit,
    unitConversions,
    defaultPackagingSpec,
    recyclable,
    fixedFormula,
  }
})
const identityEditor = computed(() => {
  const value = props.modelValue as unknown as
    SupplierData | OtherUnitData | SalesPartnerData
  return {
    operatingEntities: value.operatingEntities,
    defaultOperatingEntityId: value.defaultOperatingEntityId,
    ...('settlementMethod' in value
      ? { settlementMethod: value.settlementMethod }
      : {}),
    ...('defaultPurchaser' in value
      ? { defaultPurchaser: value.defaultPurchaser }
      : {}),
    ...('capabilities' in value ? { capabilities: value.capabilities } : {}),
  }
})
</script>
<template>
  <EditForm
    :fields="fields"
    :model-value="modelValue as EditValues"
    :disabled="disabled"
    @update:model-value="patch"
    @submit="emit('submit')"
  />
  <WflScriptBlock
    v-if="resource === 'wfl/process-definition'"
    :model-value="modelValue as unknown as WflData"
    :disabled="disabled"
    @update:model-value="patch"
    @pending="emit('pending', $event)"
  />
  <ProductDetailsEditor
    v-else-if="resource === 'bob/product'"
    :model-value="productEditor"
    :disabled="disabled"
    @update:model-value="patch"
    @pending="emit('pending', $event)"
  />
  <CustomerDetailsEditor
    v-else-if="resource === 'bob/customer'"
    :model-value="customerEditor"
    :disabled="disabled"
    @update:model-value="patch"
    @pending="emit('pending', $event)"
  />
  <IdentityAssociations
    v-else
    :model-value="identityEditor"
    :disabled="disabled"
    @update:model-value="patch"
  />
</template>
