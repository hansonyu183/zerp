<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { computed } from 'vue'
import { useTargetSession } from '../../session/vm.ts'
import {
  newCustomerSubunit,
  customerAttributionLabels,
  type CustomerSnapshot,
} from './customer-data.ts'
import AttachmentBlock from '../attachments/AttachmentBlock.vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import DetailBlock from '../dynamic-fields/DetailBlock.vue'
import SnapshotReference from '../dynamic-fields/SnapshotReference.vue'
import CustomerPricingBlock from './CustomerPricingBlock.vue'
import type { EditFields } from '../dynamic-fields/edit-fields.ts'
type Subunit = CustomerSnapshot['subunits'][number]
const props = defineProps<{
  modelValue: readonly Subunit[]
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Subunit[]]
  pending: [value: boolean]
}>()
const pendingUploads = new Set<string>()
function pending(key: string, value: boolean) {
  if (value) pendingUploads.add(key)
  else pendingUploads.delete(key)
  emit('pending', pendingUploads.size > 0)
}
const session = useTargetSession()
const readonly = computed(
  () => props.disabled || !session.can('/bob/customer/save-subunits'),
)
const fields = [
  { key: 'name', type: 'text', caption: '子单位名称', required: true },
  { key: 'contactName', type: 'text', caption: '联系人' },
  { key: 'address', type: 'textarea', caption: '业务地址' },
  { key: 'enabled', type: 'boolean', caption: '子单位启用（随本次版本审批）' },
  { key: 'internalReminder', type: 'textarea', caption: '内部提醒' },
  {
    key: 'defaultSalesOrderRemark',
    type: 'textarea',
    caption: '默认销售订单备注',
  },
] as const satisfies EditFields<Subunit>
const transport = [
  { key: 'methodCode', type: 'text', caption: '运输方式编码' },
  { key: 'methodName', type: 'text', caption: '运输方式名称' },
  { key: 'surcharge', type: 'decimal', scale: 2, caption: '运输销售加价' },
] as const satisfies EditFields<Subunit['transportPolicy']>
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
  fields: EditFields<Subunit['creditLimits'][number]>
  empty: Subunit['creditLimits'][number]
}
function update(index: number, value: Subunit) {
  if (!readonly.value)
    emit(
      'update:modelValue',
      props.modelValue.map((item, i) => (i === index ? value : item)),
    )
}
function patch(index: number, patch: Partial<Subunit>) {
  const item = props.modelValue[index]
  if (item) update(index, { ...item, ...patch } as Subunit)
}
function add() {
  if (!readonly.value)
    emit('update:modelValue', [...props.modelValue, newCustomerSubunit()])
}
function remove(index: number) {
  if (!readonly.value && props.modelValue.length > 1)
    emit(
      'update:modelValue',
      props.modelValue.filter((_, i) => i !== index),
    )
}
function attributionType(
  index: number,
  type: Subunit['primarySalesAttribution']['type'],
) {
  patch(index, {
    primarySalesAttribution:
      type === 'INTERNAL_EMPLOYEE'
        ? { type, objectId: '', code: '', name: '' }
        : { type, objectId: '', approvalEntryId: '', code: '', name: '' },
  })
}
function attribution(index: number, value: object | readonly object[] | null) {
  const sub = props.modelValue[index]
  if (!sub || !value || Array.isArray(value)) return
  patch(index, {
    primarySalesAttribution: {
      ...value,
      type: sub.primarySalesAttribution.type,
    } as Subunit['primarySalesAttribution'],
  })
}
</script>
<template>
  <section aria-label="客户子单位">
    <h3>客户子单位</h3>
    <v-alert v-if="!session.can('/bob/customer/save-subunits')" type="info"
      >当前账号没有子单位维护权限，子单位资料只读。</v-alert
    ><v-card
      v-for="(sub, index) in modelValue"
      :key="sub.id"
      :title="`客户子单位第 ${index + 1} 行 · ${sub.code ?? '待分配编码'}`"
      variant="outlined"
      class="pa-3 my-3"
    >
      <FormBlock
        :fields="fields"
        :model-value="sub"
        :disabled="readonly"
        @update:model-value="update(index, $event)"
      />
      <SnapshotReference
        source="customer-types"
        caption="客户类型"
        :model-value="sub.customerType"
        :disabled="readonly"
        @update:model-value="
          patch(index, {
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
        :model-value="sub.settlementMethod"
        :disabled="readonly"
        @update:model-value="
          patch(index, {
            settlementMethod: Array.isArray($event) ? null : $event,
          })
        "
      />
      <p v-if="sub.settlementMethod">
        结算销售加价：{{ sub.settlementMethod.defaultSalesSurcharge }}
      </p>
      <SnapshotReference
        source="sales-payment-methods"
        caption="收款方式"
        :model-value="sub.paymentMethod"
        :disabled="readonly"
        @update:model-value="
          patch(index, { paymentMethod: Array.isArray($event) ? null : $event })
        "
      />
      <p v-if="sub.paymentMethod">
        收款销售加价：{{ sub.paymentMethod.defaultSalesSurcharge }}
      </p>
      <FormBlock
        :fields="transport"
        :model-value="sub.transportPolicy"
        :disabled="readonly"
        @update:model-value="patch(index, { transportPolicy: $event })"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'type',
          type: 'choice',
          caption: '业务归属类型',
          options: Object.entries(customerAttributionLabels)
            .map(([value, title]) => ({
              value,
              title,
            }))
            .map((option) => ({ value: option.value, caption: option.title })),
        }"
        :model-value="sub.primarySalesAttribution.type"
        :disabled="readonly"
        @update:model-value="attributionType(index, $event)"
      />
      <SnapshotReference
        :source="
          sub.primarySalesAttribution.type === 'INTERNAL_EMPLOYEE'
            ? 'archive-employees'
            : sub.primarySalesAttribution.type === 'EXTERNAL_PART_TIME'
              ? 'external-salespeople'
              : 'channel-partners'
        "
        caption="主要业务归属"
        :model-value="sub.primarySalesAttribution"
        :disabled="readonly"
        @update:model-value="attribution(index, $event)"
      />
      <CustomerPricingBlock
        :model-value="sub.pricingPolicy"
        :disabled="readonly"
        @update:model-value="patch(index, { pricingPolicy: $event })"
      />
      <DetailBlock
        :definition="creditDefinition"
        :model-value="sub.creditLimits"
        mode="edit"
        :disabled="readonly"
        @update:model-value="patch(index, { creditLimits: $event })"
      />
      <AttachmentBlock
        caption="业务附件"
        :model-value="sub.attachments"
        mode="edit"
        :disabled="readonly"
        @update:model-value="patch(index, { attachments: $event })"
        @pending="pending(sub.id, $event)"
      />
      <v-btn
        :prepend-icon="actionIcons.remove"
        :disabled="readonly || modelValue.length <= 1"
        @click="remove(index)"
        >从本次版本移除子单位</v-btn
      > </v-card
    ><v-btn :prepend-icon="actionIcons.add" :disabled="readonly" @click="add"
      >添加子单位</v-btn
    >
  </section>
</template>
