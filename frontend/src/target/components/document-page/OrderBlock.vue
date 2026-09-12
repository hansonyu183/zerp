<script setup lang="ts">
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import OrderLineEditor from './OrderLineEditor.vue'
import { useOrderLineEditor } from './order-line-editor.ts'
import type { DetailFields } from '../details/detail-fields.ts'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import { ref, onBeforeUnmount, onMounted, nextTick } from 'vue'
import { ulid } from 'ulid'
import {
  resolveTargetCustomerSubunit,
  resolveTargetSupplier,
} from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import { vouPaymentMethodSelectionOriginPresentation } from '@zerp/model'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import type { FormFields } from '../dynamic-fields/form-fields.ts'
import VouReference, { type VouCandidate } from './VouReference.vue'
import { type OrderDraft, type OrderLine } from './order-data.ts'
const props = defineProps<{ modelValue: OrderDraft; disabled: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: OrderDraft]
  pending: [value: boolean]
}>()
const session = useTargetSession(),
  generation = session.generation
let active = true
const pending = ref(new Set<string>()),
  error = ref('')
const reminder = ref(''),
  defaultSurcharge = ref<string | null>(null)
const {
  product,
  invalidateLine,
  error: lineError,
} = useOrderLineEditor({
  context: () => props.modelValue,
  lines: () => props.modelValue.lines,
  update: lineUpdate,
  disabled: () => props.disabled,
  defaultSurcharge: () => defaultSurcharge.value,
  onPending: (value) => pendingGroup('lines', value),
})
function pendingGroup(key: string, value: boolean) {
  if (value) pending.value.add(key)
  else pending.value.delete(key)
  emit('pending', pending.value.size > 0)
}
function replaceLines(lines: OrderLine[]) {
  for (const row of props.modelValue.lines)
    if (!lines.some((line) => line.lineId === row.lineId))
      invalidateLine(row.lineId)
  update({ lines })
}
const lineFields = [
  {
    key: 'product',
    type: 'group',
    caption: '产品',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  { key: 'enteredQuantity', type: 'text', caption: '录入数量' },
  { key: 'baseQuantity', type: 'text', caption: '基准数量' },
  { key: 'unitPrice', type: 'text', caption: '基础单价' },
] as const satisfies DetailFields<OrderLine>
let counterpartyRequest = 0
const owns = () => active && session.generation === generation
function update(patch: Partial<OrderDraft>) {
  if (!props.disabled && owns())
    emit('update:modelValue', { ...props.modelValue, ...patch })
}
function lineUpdate(id: string, patch: Partial<OrderLine>) {
  update({
    lines: props.modelValue.lines.map((line) =>
      line.lineId === id ? { ...line, ...patch } : line,
    ),
  })
}
async function counterparty(choice: VouCandidate | null) {
  if (props.disabled) return
  const request = ++counterpartyRequest
  pending.value.delete('counterparty')
  for (const line of props.modelValue.lines) invalidateLine(line.lineId)
  emit('pending', pending.value.size > 0)
  const previousRemark = props.modelValue.remark
  update({
    counterparty: choice,
    selectionOrigin: 'CURRENT',
    paymentMethod:
      choice?.entity === 'customer-subunit' && choice.paymentMethod
        ? { ...choice.paymentMethod, selectionOrigin: 'CUSTOMER' }
        : null,
  })
  reminder.value = ''
  defaultSurcharge.value = null
  await nextTick()
  if (!choice) return
  const sale = props.modelValue.entity === 'sale-order'
  pending.value.add('counterparty')
  emit('pending', true)
  try {
    if (sale && choice.entity === 'customer-subunit') {
      const customer = await resolveTargetCustomerSubunit(
        choice.objectId,
        choice.approvalEntryId,
      )
      if (!owns() || request !== counterpartyRequest) return
      const subunit = customer.data.subunits.find(
        (item) => item.id === choice.objectId,
      )
      if (
        !customer.enabled ||
        !subunit?.enabled ||
        customer.sourceApprovalEntryId !== choice.approvalEntryId
      )
        throw new Error('客户版本已变化，请重新选择客户子单位。')
      reminder.value = subunit.internalReminder
      defaultSurcharge.value =
        subunit.settlementMethod?.defaultSalesSurcharge ?? null
      const attribution = subunit.primarySalesAttribution
      update({
        ...(props.modelValue.remark === previousRemark
          ? { remark: subunit.defaultSalesOrderRemark }
          : {}),
        ...(attribution?.type === 'INTERNAL_EMPLOYEE'
          ? {
              employee: {
                entity: 'employee',
                objectId: attribution.objectId,
                code: attribution.code,
                name: attribution.name,
              },
            }
          : {}),
      })
    } else if (!sale) {
      const supplier = await resolveTargetSupplier(
        choice.objectId,
        'approvalEntryId' in choice ? choice.approvalEntryId : undefined,
      )
      if (!owns() || request !== counterpartyRequest) return
      const employee = supplier.data.defaultPurchaser
      if (employee)
        update({
          employee: {
            entity: 'employee',
            objectId: employee.objectId,
            code: employee.code,
            name: employee.name,
          },
        })
    }
  } catch (cause) {
    if (owns() && request === counterpartyRequest)
      error.value = cause instanceof Error ? cause.message : '默认值读取失败。'
  } finally {
    if (owns() && request === counterpartyRequest) {
      for (const line of props.modelValue.lines)
        if (line.product) void product(line.lineId, line.product)
      pending.value.delete('counterparty')
      emit('pending', pending.value.size > 0)
    }
  }
}
function createLine(): OrderLine {
  return {
    lineId: ulid(),
    product: null,
    current: null,
    enteredQuantity: '',
    unitId: '',
    baseQuantity: '',
    unitPrice: '',
    settlementSurcharge: null,
    remark: '',
    formula: null,
    formulaDraft: null,
    deliverySpecificationType: 'PACKAGED',
    quantityPerContainer: '',
    containerType: '',
  }
}
function payment(choice: VouCandidate | null) {
  if (choice?.entity === 'payment-method')
    update({
      paymentMethod: {
        objectId: choice.objectId,
        code: choice.code,
        name: choice.name,
        defaultSalesSurcharge: choice.defaultSalesSurcharge,
        selectionOrigin: 'CURRENT',
      },
    })
}
const header = [
  { key: 'businessDate', type: 'date', caption: '业务日期', required: true },
  { key: 'currency', type: 'text', caption: '币种', required: true },
  { key: 'remark', type: 'textarea', caption: '备注' },
] as const satisfies FormFields<OrderDraft>
onMounted(async () => {
  const lines = props.modelValue.lines.filter(
    (line) => line.product && !line.current,
  )
  for (const line of lines)
    await product(
      line.lineId,
      line.product,
      JSON.parse(JSON.stringify(line)) as OrderLine,
    )
})
onBeforeUnmount(() => {
  active = false
  emit('pending', false)
})
</script>
<template>
  <FieldInput
    usage="edit"
    :field="{ key: 'specialApproval', type: 'boolean', caption: '特批销售' }"
    v-if="modelValue.entity === 'sale-order'"
    :model-value="modelValue.specialApproval"
    :disabled="disabled"
    @update:model-value="
      !disabled &&
      emit('update:modelValue', {
        ...modelValue,
        specialApproval: Boolean($event),
      })
    "
  />
  <section aria-label="订单录入">
    <v-alert v-if="error || lineError" type="error">{{
      error || lineError
    }}</v-alert>
    <FormBlock
      :fields="header"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update($event)"
    />
    <VouReference
      :entity="
        modelValue.entity === 'sale-order' ? 'customer-subunit' : 'supplier'
      "
      :caption="modelValue.entity === 'sale-order' ? '客户子单位' : '供应商'"
      :model-value="modelValue.counterparty"
      :disabled="disabled"
      @update:model-value="counterparty"
    />
    <v-alert v-if="reminder" type="warning"
      >客户内部提醒：{{ reminder }}</v-alert
    >
    <VouReference
      entity="warehouse"
      caption="仓库"
      :model-value="modelValue.warehouse"
      :disabled="disabled"
      @update:model-value="update({ warehouse: $event })"
    />
    <VouReference
      entity="employee"
      :caption="modelValue.entity === 'sale-order' ? '业务员' : '采购员'"
      :model-value="modelValue.employee"
      :disabled="disabled"
      @update:model-value="update({ employee: $event })"
    />
    <VouReference
      v-if="modelValue.entity === 'sale-order'"
      entity="operating-entity"
      caption="经营主体"
      :model-value="modelValue.operatingEntity"
      :disabled="disabled"
      @update:model-value="update({ operatingEntity: $event })"
    />
    <template v-if="modelValue.entity === 'sale-order'">
      <p>
        收款方式：{{ modelValue.paymentMethod?.name ?? '无' }} ·
        {{
          modelValue.paymentMethod
            ? vouPaymentMethodSelectionOriginPresentation[
                modelValue.paymentMethod.selectionOrigin
              ].label
            : '沿用客户'
        }}
      </p>
      <VouReference
        entity="payment-method"
        caption="改选收款方式"
        :model-value="
          modelValue.paymentMethod
            ? { ...modelValue.paymentMethod, entity: 'payment-method' }
            : null
        "
        :disabled="disabled"
        @update:model-value="payment"
      />
      <FormBlock
        :fields="[
          {
            key: 'creditOverrideReason',
            type: 'textarea',
            caption: '超额信用原因',
          },
        ]"
        :model-value="modelValue"
        :disabled="disabled"
        @update:model-value="update($event)"
      />
    </template>
    <CollectionBlock
      caption="商品行"
      :fields="lineFields"
      :model-value="modelValue.lines"
      mode="edit"
      :disabled="disabled"
      :create="createLine"
      @update:model-value="replaceLines"
      @pending="pendingGroup('editor', $event)"
    >
      <template
        #editor="{
          value,
          disabled: locked,
          update: updateLine,
          pending: pendingLine,
        }"
        ><OrderLineEditor
          :model-value="value"
          :entity="modelValue.entity"
          :counterparty="modelValue.counterparty"
          :default-surcharge="defaultSurcharge"
          :disabled="locked"
          @update:model-value="updateLine"
          @pending="pendingLine"
      /></template>
      <template #viewer="{ value }"
        ><OrderLineEditor
          :model-value="value"
          :entity="modelValue.entity"
          :counterparty="modelValue.counterparty"
          :default-surcharge="defaultSurcharge"
          disabled
      /></template>
    </CollectionBlock>
  </section>
</template>
