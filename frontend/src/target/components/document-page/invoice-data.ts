import type {
  TaxInformationSnapshot,
  VouAttachmentMetadata,
  VouInvoiceLine,
  VouPayloadFor,
} from '@zerp/model'
import type { VouCandidate } from './VouReference.vue'
import { businessDate } from './business-date.ts'
export type InvoiceEntity = 'sale-invoice' | 'purchase-invoice'
export interface InvoiceDraft {
  entity: InvoiceEntity
  businessDate: string
  currency: string
  remark: string
  party: VouCandidate | null
  operatingEntity: VouCandidate | null
  taxInformation: TaxInformationSnapshot | null
  invoiceLines: (VouInvoiceLine & { documentNo: string })[]
  attachments: VouAttachmentMetadata[]
}
export function emptyInvoice(entity: InvoiceEntity): InvoiceDraft {
  return {
    entity,
    businessDate: businessDate(),
    currency: 'CNY',
    remark: '',
    party: null,
    operatingEntity: null,
    taxInformation: null,
    invoiceLines: [],
    attachments: [],
  }
}
export function invoicePayload(
  value: InvoiceDraft,
): VouPayloadFor<InvoiceEntity> {
  if (
    !value.party ||
    !('approvalEntryId' in value.party) ||
    !value.party.approvalEntryId
  )
    throw new Error('请选择客户或供应商。')
  if (!value.operatingEntity) throw new Error('请选择经营主体。')
  if (!value.taxInformation)
    throw new Error(
      '请选择当前启用的税务信息；没有可选项时需先维护并批准关联。',
    )
  if (!value.invoiceLines.length) throw new Error('请选择待开票来源。')
  if (
    value.invoiceLines.some(
      (line) =>
        !/^(?:0|[1-9]\d*)\.\d{2}$/.test(line.amount) ||
        Number(line.amount) <= 0,
    )
  )
    throw new Error('开票金额须为大于零的两位小数。')
  const common = {
    businessDate: value.businessDate,
    currency: value.currency,
    remark: value.remark,
    attachments: value.attachments,
    operatingEntity: { objectId: value.operatingEntity.objectId },
    taxInformation: value.taxInformation,
    invoiceLines: value.invoiceLines.map(
      ({ documentNo: _documentNo, ...line }) => line,
    ),
  }
  const party = {
    objectId: value.party.objectId,
    approvalEntryId: value.party.approvalEntryId,
    selectionOrigin: 'CURRENT' as const,
  }
  return value.entity === 'sale-invoice'
    ? { ...common, customer: party }
    : { ...common, supplier: party }
}
