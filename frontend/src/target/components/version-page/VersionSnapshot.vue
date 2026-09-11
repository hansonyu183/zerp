<script setup lang="ts">
import { computed } from 'vue'
import type { VersionDefinition } from './definition.ts'
import type { CustomerSnapshot } from './customer-data.ts'
import type { WflData } from './wfl-data.ts'
import type { DetailField, AttachmentSource } from '../details/detail-fields.ts'
import DetailsBlock from '../details/DetailsBlock.vue'
import WflGraphBlock from './WflGraphBlock.vue'
import CustomerPricingDifference from './CustomerPricingDifference.vue'
const props = defineProps<{
  resource: VersionDefinition['resource']
  fields: readonly DetailField[]
  value: Record<string, unknown>
  previous?: Record<string, unknown>
  source?: AttachmentSource
  previousSource?: AttachmentSource
}>()
function identityPresentation(snapshot: Record<string, unknown>) {
  const id = snapshot.defaultOperatingEntityId
  if (!id) return snapshot
  const entities = snapshot.operatingEntities as
    { objectId: string; code: string; name: string }[] | undefined
  const entity = entities?.find((item) => item.objectId === id)
  return {
    ...snapshot,
    defaultOperatingEntityId: entity
      ? `${entity.code} · ${entity.name}`
      : '已采用默认主体（不在适用集合）',
  }
}
function pricingSubunits(snapshot: Record<string, unknown> | undefined) {
  return (
    (snapshot as unknown as CustomerSnapshot | undefined)?.subunits.map(
      ({ id, code, name, pricingPolicy }) => ({
        id,
        code,
        name,
        pricingPolicy,
      }),
    ) ?? []
  )
}
const customerPricingBefore = computed(() =>
  props.resource === 'bob/customer' ? pricingSubunits(props.previous) : [],
)
const customerPricingAfter = computed(() =>
  props.resource === 'bob/customer' ? pricingSubunits(props.value) : [],
)
</script>
<template>
  <template v-if="resource === 'wfl/process-definition'">
    <DetailsBlock
      v-if="source?.source === 'submission'"
      :fields="[{ key: 'script', type: 'textarea', caption: 'Starlark 脚本' }]"
      :value="value"
      :previous="previous"
    />
    <WflGraphBlock
      v-if="value.compiledGraph"
      :graph="(value as unknown as WflData).compiledGraph!"
    />
  </template>
  <DetailsBlock
    v-else
    :fields="fields"
    :value="value"
    :display="{
      value: identityPresentation(value),
      previous: previous && identityPresentation(previous),
    }"
    :previous="previous"
    :source="source"
    :previous-source="previousSource"
  />
  <CustomerPricingDifference
    v-if="resource === 'bob/customer' && previous"
    :before="customerPricingBefore"
    :after="customerPricingAfter"
  />
</template>
