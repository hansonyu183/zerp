<script setup lang="ts">
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { computed } from 'vue'
import {
  customerAttributionLabels,
  type CustomerSnapshot,
} from './customer-data.ts'
import AttachmentBlock from '../attachments/AttachmentBlock.vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import DetailBlock from '../dynamic-fields/DetailBlock.vue'
import SnapshotReference from '../dynamic-fields/SnapshotReference.vue'
import CustomerPricingBlock from './CustomerPricingBlock.vue'
import type { EditFields } from '../dynamic-fields/edit-fields.ts'
type Business = CustomerSnapshot
const props = defineProps<{
  modelValue: Business
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Business]
  pending: [value: boolean]
}>()
const pendingUploads = new Set<string>()
function pending(key: string, value: boolean) {
  if (value) pendingUploads.add(key)
  else pendingUploads.delete(key)
  emit('pending', pendingUploads.size > 0)
}
const readonly = computed(() => props.disabled)
const fields = [
  { key: 'contactName', type: 'text', caption: '联系人' },
  { key: 'address', type: 'textarea', caption: '业务地址' },
  { key: 'internalReminder', type: 'textarea', caption: '内部提醒' },
  {
    key: 'defaultSalesOrderRemark',
    type: 'textarea',
    caption: '默认销售订单备注',
  },
] as const satisfies EditFields<Business>
const transport = [
  { key: 'methodCode', type: 'text', caption: '运输方式编码' },
  { key: 'methodName', type: 'text', caption: '运输方式名称' },
  { key: 'surcharge', type: 'decimal', scale: 2, caption: '运输销售加价' },
] as const satisfies EditFields<Business['transportPolicy']>
const creditDefinition = {
  caption: '信用额度',
  fields: [
    { key: 'currency', type: 'text', caption: '币种', required: true },
    {
      key: 'amount',
      type: 'decimal',
      scale: 2,
      caption: '信用额度',
      required: true,
    },
  ],
  empty: { currency: 'CNY', amount: '0.00' },
} as const satisfies {
  caption: string
  fields: EditFields<Business['creditLimits'][number]>
  empty: Business['creditLimits'][number]
}
function update(value: Business) {
  if (!readonly.value) emit('update:modelValue', value)
}
function patch(value: Partial<Business>) {
  update({ ...props.modelValue, ...value } as Business)
}
function attributionType(type: string) {
  if (
    type !== 'UNASSIGNED' &&
    type !== 'INTERNAL_EMPLOYEE' &&
    type !== 'EXTERNAL_PART_TIME' &&
    type !== 'CHANNEL_PARTNER'
  )
    return
  patch({
    primarySalesAttribution:
      type === 'UNASSIGNED'
        ? null
        : type === 'INTERNAL_EMPLOYEE'
          ? { type, objectId: '', code: '', name: '' }
          : { type, objectId: '', approvalEntryId: '', code: '', name: '' },
  })
}
function attribution(value: object | readonly object[] | null) {
  const sub = props.modelValue
  if (!sub.primarySalesAttribution || Array.isArray(value)) return
  if (!value) {
    patch({ primarySalesAttribution: null })
    return
  }
  patch({
    primarySalesAttribution: {
      ...value,
      type: sub.primarySalesAttribution.type,
    } as Business['primarySalesAttribution'],
  })
}
</script>
<template>
  <div class="form-stack">
    <FormBlock
      :fields="fields"
      :model-value="modelValue"
      :disabled="readonly"
      @update:model-value="update($event)"
    />
    <SnapshotReference
      source="customer-types"
      caption="客户类型"
      :model-value="modelValue.customerType"
      :disabled="readonly"
      @update:model-value="
        patch({
          customerType:
            Array.isArray($event) || !$event
              ? { id: '', code: '', name: '' }
              : $event,
        })
      "
    />
    <SnapshotReference
      source="sales-settlement-methods"
      caption="结算方式"
      :model-value="modelValue.settlementMethod"
      :disabled="readonly"
      @update:model-value="
        patch({
          settlementMethod: Array.isArray($event) ? null : $event,
        })
      "
    />
    <p v-if="modelValue.settlementMethod">
      结算销售加价：{{ modelValue.settlementMethod.defaultSalesSurcharge }}
    </p>
    <SnapshotReference
      source="sales-payment-methods"
      caption="收款方式"
      :model-value="modelValue.paymentMethod"
      :disabled="readonly"
      @update:model-value="
        patch({ paymentMethod: Array.isArray($event) ? null : $event })
      "
    />
    <p v-if="modelValue.paymentMethod">
      收款销售加价：{{ modelValue.paymentMethod.defaultSalesSurcharge }}
    </p>
    <FormBlock
      :fields="transport"
      :model-value="modelValue.transportPolicy"
      :disabled="readonly"
      @update:model-value="patch({ transportPolicy: $event })"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'type',
        type: 'choice',
        caption: '业务归属类型',
        options: Object.entries({
          UNASSIGNED: '未分配',
          ...customerAttributionLabels,
        })
          .map(([value, title]) => ({
            value,
            title,
          }))
          .map((option) => ({ value: option.value, caption: option.title })),
      }"
      :model-value="modelValue.primarySalesAttribution?.type ?? 'UNASSIGNED'"
      :disabled="readonly"
      @update:model-value="attributionType($event)"
    />
    <SnapshotReference
      v-if="modelValue.primarySalesAttribution"
      :source="
        modelValue.primarySalesAttribution.type === 'INTERNAL_EMPLOYEE'
          ? 'archive-employees'
          : modelValue.primarySalesAttribution.type === 'EXTERNAL_PART_TIME'
            ? 'external-salespeople'
            : 'channel-partners'
      "
      caption="主要业务归属"
      :model-value="modelValue.primarySalesAttribution"
      :disabled="readonly"
      @update:model-value="attribution($event)"
    />
    <CustomerPricingBlock
      :model-value="modelValue.pricingPolicy"
      :disabled="readonly"
      @update:model-value="patch({ pricingPolicy: $event })"
    />
    <DetailBlock
      :definition="creditDefinition"
      :model-value="modelValue.creditLimits"
      mode="edit"
      :disabled="readonly"
      @update:model-value="patch({ creditLimits: $event })"
    />
    <AttachmentBlock
      caption="业务附件"
      :model-value="modelValue.attachments"
      mode="edit"
      :disabled="readonly"
      @update:model-value="patch({ attachments: $event })"
      @pending="pending('attachments', $event)"
    />
  </div>
</template>
