import {
  queryFormulaMaterials,
  adoptFormulaMaterials,
} from '../version-page/formula-materials.ts'
import { ref, onBeforeUnmount, nextTick } from 'vue'
import {
  resolveTargetProduct,
  queryTargetBobOptions,
  queryTargetCustomerLatestLine,
} from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import type { ProductSnapshot } from '../version-page/product-data.ts'
import type { FormFields } from '../dynamic-fields/form-fields.ts'
import type { VouCandidate } from './VouReference.vue'
import {
  unitSnapshot,
  orderFormula,
  formulaDraftFromWire,
  type OrderDraft,
  type OrderLine,
} from './order-data.ts'
export function useOrderLineEditor(options: {
  context: () => Pick<OrderDraft, 'entity' | 'counterparty'>
  lines: () => readonly OrderLine[]
  update: (id: string, value: Partial<OrderLine>) => void
  disabled: () => boolean
  defaultSurcharge: () => string | null
  onPending: (value: boolean) => void
}) {
  const session = useTargetSession(),
    generation = session.generation
  let active = true
  const pending = ref(new Set<string>()),
    requests = new Map<string, number>(),
    error = ref('')
  const historyStatus = ref<Record<string, string>>({})
  const owns = () => active && session.generation === generation
  function lineUpdate(id: string, value: Partial<OrderLine>) {
    if (!options.disabled() && owns()) options.update(id, value)
  }
  function invalidateLine(id: string) {
    requests.set(id, (requests.get(id) ?? 0) + 1)
    pending.value.delete(id)
    delete historyStatus.value[id]
    options.onPending(pending.value.size > 0)
  }
  function formulaPending(id: string, value: boolean) {
    if (!owns()) return
    if (value) pending.value.add(`formula:${id}`)
    else pending.value.delete(`formula:${id}`)
    options.onPending(pending.value.size > 0)
  }
  async function product(
    id: string,
    choice: VouCandidate | null,
    retained?: OrderLine,
  ) {
    if (options.disabled()) return
    invalidateLine(id)
    const request = requests.get(id)!
    options.onPending(pending.value.size > 0)
    lineUpdate(id, {
      product: choice,
      current: null,
      unitId: '',
      formula: null,
      formulaDraft: null,
    })
    if (!choice) return
    pending.value.add(id)
    options.onPending(true)
    try {
      let approvalEntryId =
        'approvalEntryId' in choice ? choice.approvalEntryId : undefined
      // Order wire products contain only IDs. An explicit copy creates a new draft
      // and re-adopts their current product configuration, retaining entered facts.
      if (retained && !approvalEntryId) {
        const candidates = await queryTargetBobOptions('product', {
          ids: [choice.objectId],
          enabled: 'true',
          keyword: '',
          page: '1',
          pageSize: '20',
        })
        if (!owns() || requests.get(id) !== request) return
        const candidate = candidates.items.find(
          (item) => item.objectId === choice.objectId,
        )
        if (!candidate) throw new Error('复制的产品已不可用，请重新选择。')
        approvalEntryId = candidate.sourceApprovalEntryId
      }
      const current = await resolveTargetProduct(
        choice.objectId,
        approvalEntryId,
      )
      if (!owns() || requests.get(id) !== request) return
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
            : (retained?.settlementSurcharge ?? options.defaultSurcharge()),
        formulaDraft:
          retained?.formula &&
          current.data.productType.behaviorProfile !== 'RAW_MATERIAL' &&
          current.data.productType.behaviorProfile !== 'PACKAGING'
            ? formulaDraftFromWire(retained.formula)
            : options.context().entity === 'sale-order' &&
                current.data.productType.behaviorProfile === 'STANDARD_FINISHED'
              ? (JSON.parse(
                  JSON.stringify(current.data.fixedFormula),
                ) as ProductSnapshot['fixedFormula'])
              : null,
        formula:
          options.context().entity === 'sale-order'
            ? current.data.productType.behaviorProfile === 'RAW_MATERIAL'
              ? rawFormula
              : (retained?.formula ??
                orderFormula(current.data.fixedFormula, 'PRODUCT_FIXED'))
            : null,
      })
      await nextTick()
      const adopted = options
        .lines()
        .find((line) => line.lineId === id)?.formulaDraft
      if (retained && adopted?.components.length) {
        const unresolved = {
          ...adopted,
          components: adopted.components.map((item) => ({
            ...item,
            resolutionStatus: 'UNRESOLVED' as const,
            requiresConfirmation: true,
          })),
        }
        const choices = await queryFormulaMaterials(unresolved.components)
        if (!owns() || requests.get(id) !== request) return
        formula(
          id,
          adoptFormulaMaterials(unresolved, unresolved.components, choices),
        )
      }
      if (
        !retained &&
        options.context().entity === 'sale-order' &&
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
        options.onPending(pending.value.size > 0)
      }
    }
  }
  async function adoptHistory(
    id: string,
    request: number,
    productId: string,
    needsFormula: boolean,
  ) {
    const customer = options.context().counterparty?.objectId
    if (!customer) {
      historyStatus.value[id] = '请选择客户子单位后采用最近有效订单。'
      return
    }
    const document = await queryTargetCustomerLatestLine(customer, productId)
    if (
      !owns() ||
      requests.get(id) !== request ||
      options.context().counterparty?.objectId !== customer
    )
      return
    if (document) {
      const line = document.line
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
    const previous = options.lines().find((line) => line.lineId === id)?.formula
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
      ...(options.context().entity === 'sale-order'
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

  onBeforeUnmount(() => {
    active = false
    requests.clear()
    pending.value.clear()
    options.onPending(false)
  })
  return {
    pending,
    error,
    historyStatus,
    product,
    formula,
    fields,
    invalidateLine,
    formulaPending,
  }
}
