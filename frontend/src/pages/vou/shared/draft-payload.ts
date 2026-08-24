import type { FormulaPayload } from '@/components/formula'
import type {
  VoucherDraftForm,
  VoucherReferenceInput,
} from '@/components/voucher'

export interface DraftPayload {
  businessDate: string
  currency?: string
  remark?: string
  specialApproval?: boolean
  intermediaryCalculation?: VoucherDraftForm['intermediaryCalculation']
  serviceContract?: Partial<VoucherDraftForm['serviceContract']>
  serviceAcceptance?: VoucherDraftForm['serviceAcceptance']
  returnReason?: string
  customer?: VoucherReferenceInput
  supplier?: VoucherReferenceInput
  counterpartyType?: string
  counterparty?: VoucherReferenceInput
  settlementMethod?: VoucherReferenceInput
  otherCategory?: VoucherDraftForm['otherCategory']
  employee?: VoucherReferenceInput
  salesperson?: VoucherReferenceInput
  purchaser?: VoucherReferenceInput
  handler?: VoucherReferenceInput
  warehouse?: VoucherReferenceInput
  materialWarehouse?: VoucherReferenceInput
  finishedWarehouse?: VoucherReferenceInput
  carrier?: VoucherReferenceInput
  vehicle?: VoucherReferenceInput
  fundAccount?: VoucherReferenceInput
  sourceName?: string
  amount?: string
  productLines?: Array<{
    product: { objectId: string }
    enteredQuantity: string
    enteredUnit: { objectId: string }
    baseQuantity: string
    unitPrice: string
    settlementSurcharge?: string
    purchaseUnitPrice?: string
    deliverySpecificationType?: 'PACKAGED' | 'BULK_LIQUID'
    remark?: string
    formula?: FormulaPayload
  }>
  priceLines?: Array<{
    product: VoucherReferenceInput
    unitPrice: string
    remark?: string
  }>
  expenseLines?: Array<{
    category: string
    description: string
    amount: string
    remark?: string
  }>
  assetAcquisitionLines?: Array<{
    assetName: string
    specification?: string
    category: VoucherReferenceInput
    originalValue: string
    usefulLifeMonths: number
    residualRate: string
    department: VoucherReferenceInput
    custodian?: VoucherReferenceInput
    location?: string
    remark?: string
  }>
  assetSaleLines?: Array<{
    assetId: string
    saleAmount: string
    remark?: string
  }>
  assetLiquidationLines?: Array<{
    assetId: string
    reason: string
    salvageIncome: string
    disposalExpense: string
    remark?: string
  }>
  sourceLines?: Array<{
    sourceLineId: string
    baseQuantity: string
    remark?: string
  }>
  signoffLines?: Array<{
    sourceLineId: string
    signedBaseQuantity: string
    rejectedBaseQuantity: string
    remark?: string
  }>
  returnLines?: Array<{
    sourceLineId: string
    baseQuantity: string
    remark?: string
  }>
  productionLines?: Array<{
    sourceOrderLineId?: string
    product?: { objectId: string }
    enteredQuantity: string
    enteredUnit: { objectId: string }
    baseQuantity: string
    lossRate: string
    remark?: string
    materials: Array<{
      formulaLineNo: number
      actualMaterial: { objectId: string }
      actualEnteredQuantity: string
      actualEnteredUnit: { objectId: string }
      actualBaseQuantity: string
      adjustmentReason?: string
    }>
  }>
  inventoryCountLines?: Array<{
    product: { objectId: string }
    enteredQuantity: string
    enteredUnit: { objectId: string }
    baseQuantity: string
    remark?: string
  }>
}
