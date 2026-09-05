export const accBookTemplates = [
  'ENTERPRISE',
  'SMALL_BUSINESS',
  'EMPTY',
] as const

export type AccBookTemplate = (typeof accBookTemplates)[number]

export const accSubjectDimensions = [
  'CUSTOMER_SUBUNIT',
  'SUPPLIER',
  'OTHER_UNIT',
  'EMPLOYEE',
  'SALES_PARTNER',
  'DEPARTMENT',
  'PRODUCT',
  'WAREHOUSE',
  'FUND_ACCOUNT',
  'ASSET',
  'BILL',
] as const

export type AccSubjectDimension = (typeof accSubjectDimensions)[number]

export const accSettlementPurposes = [
  'NONE',
  'RECEIVABLE',
  'PREPAID',
  'PAYABLE',
  'ADVANCE_RECEIPT',
  'OTHER',
] as const

export type AccSettlementPurpose = (typeof accSettlementPurposes)[number]
