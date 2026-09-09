<script setup lang="ts">
import type { CustomerSnapshot } from './customer-data.ts'
import AttachmentBlock from './AttachmentBlock.vue'
import DetailBlock from './DetailBlock.vue'
import SnapshotReference from './SnapshotReference.vue'
import CustomerSubunits from './CustomerSubunits.vue'
import type { EditFields } from '../direct-page/definition.ts'
type Details = Pick<
  CustomerSnapshot,
  | 'defaultOperatingEntity'
  | 'remittanceProfiles'
  | 'identityAttachments'
  | 'subunits'
>
const props = defineProps<{ modelValue: Details; disabled: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: Details]
  pending: [value: boolean]
}>()
const pendingUploads = new Set<string>()
function pending(key: string, value: boolean) {
  if (value) pendingUploads.add(key)
  else pendingUploads.delete(key)
  emit('pending', pendingUploads.size > 0)
}
const remittance = {
  caption: '汇款识别',
  fields: [
    { key: 'payerName', type: 'text', caption: '付款户名', required: true },
    { key: 'bank', type: 'text', caption: '付款银行' },
    { key: 'accountNumber', type: 'text', caption: '付款账号' },
  ],
  empty: { payerName: '', bank: '', accountNumber: '' },
} as const satisfies {
  caption: string
  fields: EditFields<Details['remittanceProfiles'][number]>
  empty: Details['remittanceProfiles'][number]
}
function update<K extends keyof Details>(key: K, value: Details[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>
<template>
  <SnapshotReference
    source="archive-operating-entities"
    caption="默认经营主体"
    :model-value="modelValue.defaultOperatingEntity"
    :disabled="disabled"
    @update:model-value="
      update('defaultOperatingEntity', Array.isArray($event) ? null : $event)
    "
  />
  <DetailBlock
    :definition="remittance"
    :model-value="modelValue.remittanceProfiles"
    mode="edit"
    :disabled="disabled"
    @update:model-value="update('remittanceProfiles', $event)"
  />
  <AttachmentBlock
    caption="身份或税务附件"
    :model-value="modelValue.identityAttachments"
    mode="edit"
    :disabled="disabled"
    @update:model-value="update('identityAttachments', $event)"
    @pending="pending('identity', $event)"
  />
  <CustomerSubunits
    @pending="pending('subunits', $event)"
    :model-value="modelValue.subunits"
    :disabled="disabled"
    @update:model-value="update('subunits', $event)"
  />
</template>
