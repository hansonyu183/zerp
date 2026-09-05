import {
  type VouEntity,
  type VouPayloadFor,
  vouEntityPresentation,
} from '@zerp/model'

export type VouPageFamily =
  | 'pricing'
  | 'order'
  | 'sales-fulfillment'
  | 'purchase-fulfillment'
  | 'production'
  | 'cash'
  | 'expense'
  | 'asset'
  | 'bill'
  | 'intermediary'
  | 'service'

export type VouEditorKind =
  | 'price-lines'
  | 'product-lines'
  | 'source-lines'
  | 'signoff-lines'
  | 'return-lines'
  | 'production-lines'
  | 'inventory-count-lines'
  | 'amount'
  | 'expense-lines'
  | 'asset-acquisition-lines'
  | 'asset-sale-lines'
  | 'asset-liquidation-lines'
  | 'bill-lines'
  | 'intermediary-calculation'
  | 'service-contract'
  | 'service-acceptance'

export interface VouPageConfig<Entity extends VouEntity = VouEntity> {
  entity: Entity
  title: string
  icon: string
  route: `/vou/${Entity}`
  useCaseKey: `vou/${Entity}`
  family: VouPageFamily
  editor: VouEditorKind
  creatable: boolean
  generatedReason?: string
  /**
   * Compile-time and test-time coverage list only. Runtime editors are explicit
   * family components and never iterate this metadata to build a form.
   */
  coveredPayloadFields: readonly (keyof VouPayloadFor<Entity> & string)[]
}

type VouPageConfigRegistry = {
  [Entity in VouEntity]: VouPageConfig<Entity>
}

const baseFields = [
  'businessDate',
  'currency',
  'remark',
  'attachments',
  'parentEntity',
  'parentDocumentId',
] as const

function page<Entity extends VouEntity>(
  entity: Entity,
  options: Omit<
    VouPageConfig<Entity>,
    'entity' | 'title' | 'route' | 'useCaseKey' | 'coveredPayloadFields'
  > & {
    fields: readonly (keyof VouPayloadFor<Entity> & string)[]
  },
): VouPageConfig<Entity> {
  const { fields, ...rest } = options
  return {
    entity,
    title: vouEntityPresentation[entity].label,
    route: `/vou/${entity}`,
    useCaseKey: `vou/${entity}`,
    coveredPayloadFields: [...baseFields, ...fields],
    ...rest,
  }
}

const generatedReason = '该单据由上游业务流程生成，只提供查询、详情与审批。'

export const vouPageConfigs = {
  'sale-pricing': page('sale-pricing', {
    icon: 'mdi-tag-multiple-outline',
    family: 'pricing',
    editor: 'price-lines',
    creatable: true,
    fields: ['priceLines'],
  }),
  'sale-order': page('sale-order', {
    icon: 'mdi-cart-arrow-down',
    family: 'order',
    editor: 'product-lines',
    creatable: true,
    fields: [
      'customerSubunit',
      'operatingEntity',
      'salesperson',
      'warehouse',
      'productLines',
      'creditOverrideReason',
    ],
  }),
  'sale-outbound': page('sale-outbound', {
    icon: 'mdi-tray-arrow-up',
    family: 'sales-fulfillment',
    editor: 'source-lines',
    creatable: false,
    generatedReason,
    fields: ['sourceLines'],
  }),
  'sale-delivery': page('sale-delivery', {
    icon: 'mdi-truck-delivery-outline',
    family: 'sales-fulfillment',
    editor: 'source-lines',
    creatable: false,
    generatedReason,
    fields: ['sourceLines', 'carrier', 'vehicle'],
  }),
  'sale-signoff': page('sale-signoff', {
    icon: 'mdi-clipboard-check-outline',
    family: 'sales-fulfillment',
    editor: 'signoff-lines',
    creatable: false,
    generatedReason,
    fields: [
      'customerSubunit',
      'expectedSolventContainers',
      'expectedResinContainers',
      'returnedSolventContainers',
      'returnedResinContainers',
      'containerDifferenceReason',
      'signoffLines',
    ],
  }),
  'sale-return': page('sale-return', {
    icon: 'mdi-keyboard-return',
    family: 'sales-fulfillment',
    editor: 'return-lines',
    creatable: true,
    fields: ['warehouse', 'returnReason', 'returnLines'],
  }),
  'purchase-order': page('purchase-order', {
    icon: 'mdi-cart-arrow-up',
    family: 'order',
    editor: 'product-lines',
    creatable: true,
    fields: ['supplier', 'purchaser', 'warehouse', 'productLines'],
  }),
  'purchase-inbound': page('purchase-inbound', {
    icon: 'mdi-tray-arrow-down',
    family: 'purchase-fulfillment',
    editor: 'source-lines',
    creatable: true,
    fields: ['supplier', 'warehouse', 'sourceLines'],
  }),
  'purchase-return': page('purchase-return', {
    icon: 'mdi-keyboard-return',
    family: 'purchase-fulfillment',
    editor: 'return-lines',
    creatable: true,
    fields: ['supplier', 'warehouse', 'returnReason', 'returnLines'],
  }),
  'purchase-inquiry': page('purchase-inquiry', {
    icon: 'mdi-comment-question-outline',
    family: 'pricing',
    editor: 'price-lines',
    creatable: true,
    fields: ['supplier', 'priceLines'],
  }),
  'order-production': page('order-production', {
    icon: 'mdi-factory',
    family: 'production',
    editor: 'production-lines',
    creatable: true,
    fields: ['materialWarehouse', 'finishedWarehouse', 'productionLines'],
  }),
  'self-production': page('self-production', {
    icon: 'mdi-cog-transfer-outline',
    family: 'production',
    editor: 'production-lines',
    creatable: true,
    fields: ['materialWarehouse', 'finishedWarehouse', 'productionLines'],
  }),
  'inventory-count': page('inventory-count', {
    icon: 'mdi-clipboard-list-outline',
    family: 'production',
    editor: 'inventory-count-lines',
    creatable: true,
    fields: ['warehouse', 'inventoryCountLines'],
  }),
  'sales-receipt': page('sales-receipt', {
    icon: 'mdi-cash-plus',
    family: 'cash',
    editor: 'amount',
    creatable: true,
    fields: [
      'customer',
      'operatingEntity',
      'fundAccount',
      'handler',
      'amount',
      'subunitAllocations',
    ],
  }),
  'purchase-refund': page('purchase-refund', {
    icon: 'mdi-cash-plus',
    family: 'cash',
    editor: 'amount',
    creatable: true,
    fields: ['supplier', 'fundAccount', 'handler', 'amount'],
  }),
  'other-receipt': page('other-receipt', {
    icon: 'mdi-cash-plus',
    family: 'cash',
    editor: 'amount',
    creatable: true,
    fields: [
      'counterparty',
      'counterpartyType',
      'otherCategory',
      'fundAccount',
      'handler',
      'amount',
    ],
  }),
  'sales-refund': page('sales-refund', {
    icon: 'mdi-cash-minus',
    family: 'cash',
    editor: 'amount',
    creatable: true,
    fields: ['customer', 'fundAccount', 'handler', 'amount'],
  }),
  'purchase-payment': page('purchase-payment', {
    icon: 'mdi-cash-minus',
    family: 'cash',
    editor: 'amount',
    creatable: true,
    fields: ['supplier', 'fundAccount', 'handler', 'amount'],
  }),
  'other-payment': page('other-payment', {
    icon: 'mdi-cash-minus',
    family: 'cash',
    editor: 'amount',
    creatable: true,
    fields: [
      'counterparty',
      'counterpartyType',
      'otherCategory',
      'fundAccount',
      'handler',
      'amount',
    ],
  }),
  'employee-loan': page('employee-loan', {
    icon: 'mdi-account-cash-outline',
    family: 'cash',
    editor: 'amount',
    creatable: true,
    fields: ['employee', 'fundAccount', 'handler', 'amount'],
  }),
  'employee-repayment': page('employee-repayment', {
    icon: 'mdi-cash-refund',
    family: 'cash',
    editor: 'amount',
    creatable: true,
    fields: ['employee', 'fundAccount', 'handler', 'amount'],
  }),
  'employee-loan-writeoff': page('employee-loan-writeoff', {
    icon: 'mdi-receipt-text-check-outline',
    family: 'expense',
    editor: 'expense-lines',
    creatable: true,
    fields: ['employee', 'expenseLines'],
  }),
  'expense-reimbursement': page('expense-reimbursement', {
    icon: 'mdi-receipt-text-outline',
    family: 'expense',
    editor: 'expense-lines',
    creatable: true,
    fields: ['employee', 'expenseLines'],
  }),
  'expense-payment': page('expense-payment', {
    icon: 'mdi-cash-check',
    family: 'expense',
    editor: 'amount',
    creatable: false,
    generatedReason,
    fields: ['employee', 'fundAccount', 'handler', 'amount'],
  }),
  'other-income': page('other-income', {
    icon: 'mdi-cash-multiple',
    family: 'cash',
    editor: 'amount',
    creatable: true,
    fields: [
      'sourceName',
      'counterparty',
      'counterpartyType',
      'fundAccount',
      'handler',
      'amount',
    ],
  }),
  'asset-acquisition': page('asset-acquisition', {
    icon: 'mdi-office-building-plus-outline',
    family: 'asset',
    editor: 'asset-acquisition-lines',
    creatable: true,
    fields: ['supplier', 'assetAcquisitionLines'],
  }),
  'asset-sale': page('asset-sale', {
    icon: 'mdi-office-building-minus-outline',
    family: 'asset',
    editor: 'asset-sale-lines',
    creatable: true,
    fields: ['counterparty', 'counterpartyType', 'assetSaleLines'],
  }),
  'asset-liquidation': page('asset-liquidation', {
    icon: 'mdi-office-building-remove-outline',
    family: 'asset',
    editor: 'asset-liquidation-lines',
    creatable: true,
    fields: ['assetLiquidationLines'],
  }),
  'bill-receipt': page('bill-receipt', {
    icon: 'mdi-receipt-text-outline',
    family: 'bill',
    editor: 'bill-lines',
    creatable: true,
    fields: [
      'customer',
      'handler',
      'internalCostRateBps',
      'billLines',
      'billCashLines',
    ],
  }),
  'bill-payment': page('bill-payment', {
    icon: 'mdi-receipt-text-send-outline',
    family: 'bill',
    editor: 'bill-lines',
    creatable: true,
    fields: ['supplier', 'handler', 'billLines', 'billCashLines'],
  }),
  'bill-issue': page('bill-issue', {
    icon: 'mdi-receipt-text-plus-outline',
    family: 'bill',
    editor: 'bill-lines',
    creatable: true,
    fields: [
      'supplier',
      'interestMode',
      'interestParty',
      'billLines',
      'billCashLines',
    ],
  }),
  'bill-discount': page('bill-discount', {
    icon: 'mdi-cash-fast',
    family: 'bill',
    editor: 'bill-lines',
    creatable: true,
    fields: [
      'counterparty',
      'counterpartyType',
      'interestMode',
      'interestParty',
      'withRecourse',
      'billLines',
      'billCashLines',
    ],
  }),
  'bill-maturity': page('bill-maturity', {
    icon: 'mdi-calendar-clock-outline',
    family: 'bill',
    editor: 'bill-lines',
    creatable: true,
    fields: ['maturityType', 'billLines', 'billCashLines'],
  }),
  'intermediary-calculation': page('intermediary-calculation', {
    icon: 'mdi-calculator-variant-outline',
    family: 'intermediary',
    editor: 'intermediary-calculation',
    creatable: true,
    fields: ['intermediaryCalculation'],
  }),
  'service-contract': page('service-contract', {
    icon: 'mdi-file-sign',
    family: 'service',
    editor: 'service-contract',
    creatable: true,
    fields: ['counterparty', 'counterpartyType', 'employee', 'serviceContract'],
  }),
  'service-acceptance': page('service-acceptance', {
    icon: 'mdi-file-check-outline',
    family: 'service',
    editor: 'service-acceptance',
    creatable: true,
    fields: ['employee', 'serviceAcceptance'],
  }),
} as const satisfies VouPageConfigRegistry
