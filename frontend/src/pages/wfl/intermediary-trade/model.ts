import { ApiError, getErrorMessage } from '@/api/types'
import { parseFixed } from '@/components/voucher/decimal'
import { localDate } from '@/utils/date'
import type { IntermediaryChildPrefix } from './api'
import type {
  IntermediaryBalances,
  IntermediaryChildStage,
  IntermediaryContainerBalance,
  IntermediaryOrderDraft,
  IntermediaryWireDocument,
  IntermediaryWorkflowDocument,
} from './types'

const emptyBalances = (): IntermediaryBalances => ({
  lines: [],
  containers: [
    { containerType: 'SOLVENT', quantity: 0 },
    { containerType: 'RESIN', quantity: 0 },
  ],
  hasUnfinishedChildren: false,
})

export function emptyOrder(): IntermediaryOrderDraft {
  return {
    businessDate: localDate(),
    currency: 'CNY',
    customer: null,
    salesperson: null,
    remark: '',
    productLines: [],
  }
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function childPrefix(
  stage: IntermediaryChildStage,
): IntermediaryChildPrefix {
  return stage.toLowerCase() as IntermediaryChildPrefix
}

export function toDocument(
  value: IntermediaryWireDocument,
): IntermediaryWorkflowDocument {
  if (!value.data.customer || !value.data.salesperson) {
    throw new Error('流程根单缺少客户或业务员快照。')
  }
  return {
    processId: value.processId,
    rootDocumentId: value.rootDocumentId,
    documentId: value.documentId,
    documentNo: value.documentNo,
    workflowStatus:
      value.workflowStatus as IntermediaryWorkflowDocument['workflowStatus'],
    rootRevision: value.rootRevision || value.revision,
    documentRevision: value.revision,
    businessDate: value.data.businessDate,
    currency: value.data.currency,
    amount: value.amount,
    customer: value.data.customer,
    salesperson: value.data.salesperson,
    customerSettlementMethod: value.data.customerSettlementMethod,
    contactName: value.data.contactName,
    contactPhone: value.data.contactPhone,
    deliveryAddress: value.data.deliveryAddress,
    productLines: value.data.productLines ?? [],
    balances: value.balances ?? emptyBalances(),
    children: value.children ?? [],
    attachments: value.attachments ?? [],
    checkedBy: value.checkedBy,
    checkedAt: value.checkedAt,
    approvedBy: value.approvedBy,
    approvedAt: value.approvedAt,
    completedAt: value.completedAt,
    remark: value.data.remark,
    updatedAt: value.updatedAt,
  }
}

export function orderFromDocument(
  value: IntermediaryWorkflowDocument,
): IntermediaryOrderDraft {
  return {
    businessDate: value.businessDate,
    currency: value.currency,
    customer: { ...value.customer },
    salesperson: { ...value.salesperson },
    remark: value.remark ?? '',
    productLines: value.productLines.map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      product: {
        ...line.product,
        containerType: line.containerType,
        quantityPerContainer: line.quantityPerContainer,
      },
      orderedQuantity: line.orderedQuantity,
      unitPrice: line.unitPrice,
      containerType: line.containerType || 'NONE',
      quantityPerContainer: line.quantityPerContainer ?? '',
      remark: line.remark ?? '',
    })),
  }
}

export function containerBalance(
  balances?: IntermediaryBalances,
): IntermediaryContainerBalance {
  return {
    solvent:
      balances?.containers.find((item) => item.containerType === 'SOLVENT')
        ?.quantity ?? 0,
    resin:
      balances?.containers.find((item) => item.containerType === 'RESIN')
        ?.quantity ?? 0,
  }
}

export function formatQuantity(micros: bigint): string {
  const whole = micros / 1_000_000n
  const fraction = (micros % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function remaining(totalValue: string, usedValue: string): string {
  const total = parseFixed(totalValue, 6, true)
  const used = parseFixed(usedValue, 6, true)
  if (total === null || used === null || used >= total) return '0'
  return formatQuantity(total - used)
}

export function workflowErrorMessage(error: unknown): string {
  const message = getErrorMessage(error)
  return error instanceof ApiError && error.code === 3001
    ? `${message} 请重新加载流程后重试。`
    : message
}
