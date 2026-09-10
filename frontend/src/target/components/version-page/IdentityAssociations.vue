<script setup lang="ts">
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { salesPartnerCapabilityOptions } from './identity-data.ts'
import { computed } from 'vue'
import type { SupplierData, OtherUnitData, SalesPartnerData } from '@zerp/model'
import SnapshotReference from '../dynamic-fields/SnapshotReference.vue'
type Identity = SupplierData | OtherUnitData | SalesPartnerData
type Associations = Pick<
  Identity,
  'operatingEntities' | 'defaultOperatingEntityId'
> & {
  settlementMethod?: SupplierData['settlementMethod']
  defaultPurchaser?: SupplierData['defaultPurchaser']
  capabilities?: SalesPartnerData['capabilities']
}
const props = defineProps<{ modelValue: Associations; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Associations] }>()
function update<K extends keyof Associations>(key: K, value: Associations[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
const defaults = computed(() => {
  const items = props.modelValue.operatingEntities.map((item) => ({
    value: item.objectId,
    title: `${item.code} · ${item.name}`,
  }))
  const selected = props.modelValue.defaultOperatingEntityId
  if (selected && !items.some((item) => item.value === selected))
    items.push({ value: selected, title: '已采用默认主体（不在适用集合）' })
  return items
})
</script>
<template>
  <SnapshotReference
    source="archive-operating-entities"
    caption="适用经营主体"
    :model-value="modelValue.operatingEntities"
    :disabled="disabled"
    multiple
    @update:model-value="
      update('operatingEntities', Array.isArray($event) ? $event : [])
    "
  />
  <FieldInput
    usage="edit"
    :field="{
      key: 'defaultOperatingEntityId',
      type: 'choice',
      caption: '默认经营主体',
      options: defaults.map((option) => ({
        value: option.value,
        caption: option.title,
      })),
    }"
    :model-value="modelValue.defaultOperatingEntityId"
    :disabled="disabled"
    clearable
    @update:model-value="update('defaultOperatingEntityId', $event)"
  />
  <SnapshotReference
    v-if="'settlementMethod' in modelValue"
    source="settlement-rules"
    caption="结算方式"
    :model-value="modelValue.settlementMethod ?? null"
    :disabled="disabled"
    @update:model-value="
      update('settlementMethod', Array.isArray($event) ? null : $event)
    "
  />
  <SnapshotReference
    v-if="'defaultPurchaser' in modelValue"
    source="archive-employees"
    caption="默认采购员"
    :model-value="modelValue.defaultPurchaser ?? null"
    :disabled="disabled"
    @update:model-value="
      update('defaultPurchaser', Array.isArray($event) ? null : $event)
    "
  />
  <FieldInput
    usage="edit"
    :field="{
      key: 'capabilities',
      type: 'choice',
      caption: '合作能力',
      options: salesPartnerCapabilityOptions.map((option) => ({
        value: option.value,
        caption: option.caption,
      })),
      multiple: true,
    }"
    v-if="'capabilities' in modelValue"
    :model-value="modelValue.capabilities"
    :disabled="disabled"
    @update:model-value="update('capabilities', $event)"
  />
</template>
