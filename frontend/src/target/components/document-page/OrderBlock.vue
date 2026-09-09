<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted, nextTick } from 'vue'
import { ulid } from 'ulid'
import {
  getTargetProduct,
  getTargetCustomer,
  getTargetSupplier,
  queryTargetVouchers,
  getTargetVoucher,
} from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import ProductFormulaBlock from '../version-page/ProductFormulaBlock.vue'
import type { ProductSnapshot } from '../version-page/product-data.ts'
import { vouPaymentMethodSelectionOriginPresentation } from '@zerp/model'
import FormBlock from '../version-page/FormBlock.vue'
import type { FormFields } from '../version-page/form-fields.ts'
import VouReference, { type VouCandidate } from './VouReference.vue'
import {
  unitSnapshot,
  orderFormula,
  formulaDraftFromWire,
  type OrderDraft,
  type OrderLine,
} from './order-data.ts'
const props = defineProps<{ modelValue: OrderDraft; disabled: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: OrderDraft]
  pending: [value: boolean]
}>()
const session = useTargetSession(),
  generation = session.generation
let active = true
const pending = ref(new Set<string>()),
  requests = new Map<string, number>(),
  error = ref('')
const historyStatus = ref<Record<string, string>>({})
const reminder = ref(''),
  defaultSurcharge = ref<string | null>(null)
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
function invalidateLine(id: string) {
  requests.set(id, (requests.get(id) ?? 0) + 1)
  pending.value.delete(id)
  pending.value.delete(`formula:${id}`)
  delete historyStatus.value[id]
}
function removeLine(id: string) {
  if (props.disabled) return
  invalidateLine(id)
  update({ lines: props.modelValue.lines.filter((line) => line.lineId !== id) })
  emit('pending', pending.value.size > 0)
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
  if (!choice || !session.csrfToken) return
  const sale = props.modelValue.entity === 'sale-order'
  const permission = sale ? '/bob/customer/get' : '/bob/supplier/get'
  if (!session.can(permission)) {
    for (const line of props.modelValue.lines)
      if (line.product) void product(line.lineId, line.product)
    return
  }
  pending.value.add('counterparty')
  emit('pending', true)
  try {
    if (sale && choice.entity === 'customer-subunit') {
      const customer = await getTargetCustomer(
        session.csrfToken,
        choice.customerId,
      )
      if (
        !owns() ||
        request !== counterpartyRequest ||
        !session.can(permission)
      )
        return
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
      const supplier = await getTargetSupplier(
        session.csrfToken,
        choice.objectId,
      )
      if (
        !owns() ||
        request !== counterpartyRequest ||
        !session.can(permission)
      )
        return
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
function addLine() {
  update({
    lines: [
      ...props.modelValue.lines,
      {
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
      },
    ],
  })
}
async function product(
  id: string,
  choice: VouCandidate | null,
  retained?: OrderLine,
) {
  if (props.disabled) return
  invalidateLine(id)
  const request = requests.get(id)!
  emit('pending', pending.value.size > 0)
  lineUpdate(id, {
    product: choice,
    current: null,
    unitId: '',
    formula: null,
    formulaDraft: null,
  })
  if (!choice) return
  if (!session.can('/bob/product/get') || !session.csrfToken) {
    error.value = '没有产品读取权限，无法采用产品单位与配方。'
    return
  }
  pending.value.add(id)
  emit('pending', true)
  try {
    const current = await getTargetProduct(session.csrfToken, choice.objectId)
    if (
      !owns() ||
      requests.get(id) !== request ||
      !session.can('/bob/product/get')
    )
      return
    if (!current.enabled) throw new Error('产品已停用，请重新选择。')
    const unit = unitSnapshot(current.data.defaultInputUnit)
    const rawFormula = {
      sourceType: 'RAW_SELF' as const,
      output: { enteredQuantity: '1', enteredUnit: unit, baseQuantity: '1' },
      components: [
        {
          material: { objectId: choice.objectId },
          quantity: {
            enteredQuantity: '1',
            enteredUnit: unit,
            baseQuantity: '1',
          },
        },
      ],
    }
    lineUpdate(id, {
      product: {
        entity: 'product',
        objectId: current.objectId,
        approvalEntryId: current.sourceApprovalEntryId,
        code: current.code,
        name: current.data.name,
      },
      current,
      unitId: retained?.unitId ?? current.data.defaultInputUnit.id,
      quantityPerContainer:
        retained?.quantityPerContainer ??
        current.data.defaultPackagingSpec ??
        '',
      settlementSurcharge:
        current.data.productType.behaviorProfile === 'PACKAGING'
          ? '0.00'
          : (retained?.settlementSurcharge ?? defaultSurcharge.value),
      formulaDraft:
        retained?.formula &&
        current.data.productType.behaviorProfile !== 'RAW_MATERIAL' &&
        current.data.productType.behaviorProfile !== 'PACKAGING'
          ? formulaDraftFromWire(retained.formula)
          : props.modelValue.entity === 'sale-order' &&
              current.data.productType.behaviorProfile === 'STANDARD_FINISHED'
            ? (JSON.parse(
                JSON.stringify(current.data.fixedFormula),
              ) as ProductSnapshot['fixedFormula'])
            : null,
      formula:
        props.modelValue.entity === 'sale-order'
          ? current.data.productType.behaviorProfile === 'RAW_MATERIAL'
            ? rawFormula
            : (retained?.formula ??
              orderFormula(current.data.fixedFormula, 'PRODUCT_FIXED'))
          : null,
    })
    await nextTick()
    if (
      !retained &&
      props.modelValue.entity === 'sale-order' &&
      current.data.productType.behaviorProfile !== 'PACKAGING'
    )
      await adoptHistory(
        id,
        request,
        choice.objectId,
        current.data.productType.behaviorProfile === 'CUSTOM_FINISHED',
      )
  } catch (cause) {
    if (owns() && requests.get(id) === request)
      error.value = cause instanceof Error ? cause.message : '产品读取失败。'
  } finally {
    if (owns() && requests.get(id) === request) {
      pending.value.delete(id)
      emit('pending', pending.value.size > 0)
    }
  }
}
async function adoptHistory(
  id: string,
  request: number,
  productId: string,
  needsFormula: boolean,
) {
  const customer = props.modelValue.counterparty?.objectId
  if (
    !customer ||
    !session.can('/vou/sale-order/query') ||
    !session.can('/vou/sale-order/get') ||
    !session.csrfToken
  ) {
    historyStatus.value[id] = !customer
      ? '请选择客户子单位后采用最近有效订单。'
      : '没有历史订单读取权限，请手工确认交付规格与配方。'
    return
  }
  const found: Awaited<ReturnType<typeof queryTargetVouchers>>['items'] = []
  for (let page = 1; ; page++) {
    const result = await queryTargetVouchers(session.csrfToken, 'sale-order', {
      page,
      pageSize: 20,
      filters: {
        counterpartyObjectId: customer,
        status: ['PENDING', 'APPROVED'],
      },
      sort: [{ field: 'businessDate', order: 'desc' }],
    })
    if (
      !owns() ||
      requests.get(id) !== request ||
      props.modelValue.counterparty?.objectId !== customer
    )
      return
    found.push(...result.items)
    if (found.length >= result.total || !result.items.length) break
  }
  found.sort(
    (a, b) =>
      b.businessDate.localeCompare(a.businessDate) ||
      b.documentNo.localeCompare(a.documentNo),
  )
  for (const row of found) {
    if (!session.can('/vou/sale-order/get') || !session.csrfToken) return
    const document = await getTargetVoucher(
      session.csrfToken,
      'sale-order',
      row.documentId,
    )
    if (
      !owns() ||
      requests.get(id) !== request ||
      props.modelValue.counterparty?.objectId !== customer
    )
      return
    if (
      document.entity !== 'sale-order' ||
      !('productLines' in document.payload)
    )
      continue
    const line = document.payload.productLines.find(
      (line) => line.product.objectId === productId,
    )
    if (!line) continue
    lineUpdate(id, {
      deliverySpecificationType: line.deliverySpecificationType ?? 'PACKAGED',
      containerType: line.containerType ?? '',
      quantityPerContainer: line.quantityPerContainer ?? '',
    })
    if (needsFormula && line.formula) {
      const formulaDraft = formulaDraftFromWire(line.formula)
      lineUpdate(id, {
        formulaDraft,
        formula: {
          ...line.formula,
          sourceType: 'CUSTOMER_LATEST',
          sourceDocumentId: document.documentId,
          sourceDocumentNo: document.documentNo,
        },
      })
    }
    historyStatus.value[id] =
      `已采用最近有效订单 ${document.documentNo} 的交付规格${needsFormula && line.formula ? '与配方' : ''}。`
    return
  }
  historyStatus.value[id] =
    '没有该客户与产品的有效历史订单，请手工确认交付规格与配方。'
}
function formula(id: string, value: ProductSnapshot['fixedFormula']) {
  const previous = props.modelValue.lines.find(
    (line) => line.lineId === id,
  )?.formula
  const next = orderFormula(value, previous?.sourceType ?? 'MANUAL')
  lineUpdate(id, {
    formulaDraft: value,
    formula: next && {
      ...next,
      ...(previous?.sourceDocumentId
        ? {
            sourceDocumentId: previous.sourceDocumentId,
            sourceDocumentNo: previous.sourceDocumentNo,
          }
        : {}),
    },
  })
}
function formulaPending(id: string, value: boolean) {
  if (value) pending.value.add(`formula:${id}`)
  else pending.value.delete(`formula:${id}`)
  emit('pending', pending.value.size > 0)
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
function fields(line: OrderLine): FormFields<OrderLine> {
  return [
    {
      key: 'enteredQuantity',
      type: 'decimal',
      scale: 6,
      caption: '录入数量',
      required: true,
    },
    {
      key: 'unitId',
      type: 'enum',
      caption: '录入单位',
      required: true,
      options:
        line.current?.data.unitConversions.map((item) => ({
          value: item.unit.id,
          caption: `${item.unit.name}（${item.unit.symbol}，${item.unit.quantityScale} 位小数）`,
        })) ?? [],
    },
    {
      key: 'baseQuantity',
      type: 'decimal',
      scale: 6,
      caption: '基准数量',
      required: true,
    },
    {
      key: 'unitPrice',
      type: 'decimal',
      scale: 2,
      caption: '基础单价',
      required: true,
    },
    ...(props.modelValue.entity === 'sale-order'
      ? [
          {
            key: 'settlementSurcharge' as const,
            type: 'decimal' as const,
            scale: 2,
            caption: '销售加价',
          },
          {
            key: 'deliverySpecificationType' as const,
            type: 'enum' as const,
            caption: '交付规格',
            options: [
              { value: 'PACKAGED', caption: '有包装' },
              { value: 'BULK_LIQUID', caption: '散水' },
            ],
          },
          {
            key: 'quantityPerContainer' as const,
            type: 'decimal' as const,
            scale: 6,
            caption: '每容器数量',
          },
          {
            key: 'containerType' as const,
            type: 'text' as const,
            caption: '容器类型',
          },
        ]
      : []),
    { key: 'remark', type: 'textarea', caption: '行备注' },
  ]
}
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
  <section aria-label="订单录入">
    <v-alert v-if="error" type="error">{{ error }}</v-alert>
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
    <v-card
      v-for="(line, index) in modelValue.lines"
      :key="line.lineId"
      :title="`商品行第 ${index + 1} 行`"
      variant="outlined"
      class="my-3 pa-3"
    >
      <VouReference
        entity="product"
        caption="产品"
        :model-value="line.product"
        :disabled="disabled"
        @update:model-value="product(line.lineId, $event)"
      />
      <p v-if="historyStatus[line.lineId]">{{ historyStatus[line.lineId] }}</p>
      <v-progress-linear v-if="pending.has(line.lineId)" indeterminate />
      <FormBlock
        :fields="fields(line)"
        :model-value="line"
        :disabled="disabled || pending.has(line.lineId)"
        @update:model-value="lineUpdate(line.lineId, $event)"
      />
      <template v-if="modelValue.entity === 'sale-order' && line.current">
        <p
          v-if="
            line.current.data.productType.behaviorProfile === 'RAW_MATERIAL'
          "
        >
          原材料采用自身配方：基准产量 1、自身用量 1，不可编辑。
        </p>
        <ProductFormulaBlock
          v-else-if="
            line.current.data.productType.behaviorProfile !== 'PACKAGING'
          "
          :key="`${line.current.sourceApprovalEntryId}:${line.formula?.sourceDocumentId ?? ''}`"
          :model-value="line.formulaDraft"
          :disabled="disabled"
          @update:model-value="formula(line.lineId, $event)"
          @pending="formulaPending(line.lineId, $event)"
        />
      </template>
      <v-btn :disabled="disabled" @click="removeLine(line.lineId)"
        >移除商品行第 {{ index + 1 }} 行</v-btn
      >
    </v-card>
    <v-btn :disabled="disabled" @click="addLine">添加商品行</v-btn>
  </section>
</template>
