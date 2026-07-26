import type {
  VoucherDocumentView,
  VoucherDraftForm,
  VoucherEntityConfig,
  VoucherReference,
  VoucherReferenceInput,
  VoucherReferenceView,
} from '@/components/voucher'
import { localDate } from '@/utils/date'

export interface DraftPayload {
  businessDate: string
  currency: string
  remark?: string
  customer?: VoucherReferenceInput
  supplier?: VoucherReferenceInput
  counterpartyType?: string
  counterparty?: VoucherReferenceInput
  employee?: VoucherReferenceInput
  salesperson?: VoucherReferenceInput
  purchaser?: VoucherReferenceInput
  handler?: VoucherReferenceInput
  warehouse?: VoucherReferenceInput
  fundAccount?: VoucherReferenceInput
  sourceName?: string
  amount?: string
  productLines?: Array<{
    product: VoucherReferenceInput
    orderedQuantity: string
    unitPrice: string
    purchaseUnitPrice?: string
    remark?: string
  }>
  expenseLines?: Array<{
    category: string
    description: string
    amount: string
    remark?: string
  }>
}

export function emptyForm(config: VoucherEntityConfig): VoucherDraftForm {
  return {
    businessDate: localDate(),
    currency: config.usesFundAccount ? '' : 'CNY',
    remark: '',
    customer: null,
    supplier: null,
    counterpartyType: config.partyMode === 'counterparty' ? 'customer' : '',
    counterparty: null,
    employee: null,
    salesperson: null,
    purchaser: null,
    handler: null,
    warehouse: null,
    fundAccount: null,
    sourceName: '',
    amount: '',
    productLines: config.lineKind === 'product'
      ? [{
        key: crypto.randomUUID(),
        product: null,
        orderedQuantity: '',
        unitPrice: '',
        purchaseUnitPrice: '',
        remark: '',
      }]
      : [],
    expenseLines: config.lineKind === 'expense'
      ? [{
        key: crypto.randomUUID(),
        category: '',
        description: '',
        amount: '',
        remark: '',
      }]
      : [],
  }
}

export function inputReference(
  reference: VoucherReference | VoucherReferenceView | null | undefined,
): VoucherReferenceInput | undefined {
  return reference
    ? { objectId: reference.objectId, versionId: reference.versionId }
    : undefined
}

function formReference(
  reference: VoucherReferenceView | undefined,
): VoucherReference | null {
  return reference ? { ...reference } : null
}

export function formFromDocument(
  document: VoucherDocumentView,
): VoucherDraftForm {
  const data = document.data
  return {
    businessDate: data.businessDate,
    currency: data.currency,
    remark: data.remark ?? '',
    customer: formReference(data.customer),
    supplier: formReference(data.supplier),
    counterpartyType: data.counterparty?.entity === 'supplier'
      ? 'supplier'
      : data.counterparty ? 'customer' : '',
    counterparty: formReference(data.counterparty),
    employee: formReference(data.employee),
    salesperson: formReference(data.salesperson),
    purchaser: formReference(data.purchaser),
    handler: formReference(data.handler),
    warehouse: formReference(data.warehouse),
    fundAccount: formReference(data.fundAccount),
    sourceName: data.sourceName ?? '',
    amount: document.amount,
    productLines: (data.productLines ?? []).map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      product: formReference(line.product),
      orderedQuantity: line.orderedQuantity,
      unitPrice: line.unitPrice,
      purchaseUnitPrice: line.purchaseUnitPrice ?? '',
      remark: line.remark ?? '',
    })),
    expenseLines: (data.expenseLines ?? []).map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      category: line.category,
      description: line.description,
      amount: line.amount,
      remark: line.remark ?? '',
    })),
  }
}

export function snapshot(value: VoucherDraftForm): string {
  return JSON.stringify(value)
}
