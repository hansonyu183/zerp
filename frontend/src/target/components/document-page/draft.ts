import type * as api from '../../api.ts'
import type { VouType } from '@zerp/model'
import type { VouDetail } from './list-runtime.ts'
import { ulid } from 'ulid'
import { emptyOpening, type OpeningDraft } from './opening-data.ts'
import {
  emptyOrder,
  orderPayload,
  cloneOrder,
  type OrderDraft,
} from './order-data.ts'
import {
  billEntities,
  emptyBill,
  billPayload,
  cloneBill,
  type BillEntity,
  type BillDraft,
} from './bill-data.ts'
import {
  assetEntities,
  emptyAsset,
  assetPayload,
  cloneAsset,
  type AssetDraft,
  type AssetEntity,
} from './asset-data.ts'
import {
  financialEntities,
  emptyFinancial,
  financialPayload,
  cloneFinancial,
  type FinancialDraft,
  type FinancialEntity,
} from './financial-data.ts'
import {
  cloneProduction,
  emptyProduction,
  productionPayload,
  type ProductionDraft,
  type ProductionEntity,
} from './production-data.ts'
import {
  cloneProductFacts,
  emptyProductFacts,
  productFactsPayload,
  type ProductFactsDraft,
  type ProductFactsEntity,
} from './product-facts-data.ts'
import {
  cloneFulfillment,
  emptyFulfillment,
  fulfillmentPayload,
  type FulfillmentDraft,
  type FulfillmentEntity,
} from './fulfillment-data.ts'
import {
  serviceEntities,
  emptyService,
  cloneService,
  servicePayload,
  type ServiceEntity,
  type ServiceDraft,
} from './service-data.ts'
import {
  emptyIntermediary,
  intermediaryPayload,
  type IntermediaryDraft,
} from './intermediary-data.ts'
export type EditorDraft =
  | { kind: 'intermediary'; value: IntermediaryDraft }
  | { kind: 'service'; value: ServiceDraft }
  | { kind: 'bill'; value: BillDraft }
  | { kind: 'asset'; value: AssetDraft }
  | { kind: 'financial'; value: FinancialDraft }
  | { kind: 'order'; value: OrderDraft }
  | { kind: 'fulfillment'; value: FulfillmentDraft }
  | { kind: 'product-facts'; value: ProductFactsDraft }
  | { kind: 'production'; value: ProductionDraft }
  | { kind: 'opening'; value: OpeningDraft }

export function createDocumentDraft(entity: VouType): EditorDraft | null {
  switch (entity) {
    case 'sale-order':
    case 'purchase-order':
      return { kind: 'order', value: emptyOrder(entity) }
    case 'service-contract':
    case 'service-acceptance':
      return { kind: 'service', value: emptyService(entity) }
    case 'bill-receipt':
    case 'bill-payment':
    case 'bill-issue':
    case 'bill-discount':
    case 'bill-maturity':
      return { kind: 'bill', value: emptyBill(entity) }
    case 'asset-acquisition':
    case 'asset-sale':
    case 'asset-liquidation':
      return { kind: 'asset', value: emptyAsset(entity) }
    case 'sales-receipt':
    case 'purchase-refund':
    case 'other-receipt':
    case 'sales-refund':
    case 'purchase-payment':
    case 'other-payment':
    case 'employee-loan':
    case 'employee-repayment':
    case 'employee-loan-writeoff':
    case 'expense-reimbursement':
    case 'other-income':
      return { kind: 'financial', value: emptyFinancial(entity) }
    case 'order-production':
    case 'self-production':
      return { kind: 'production', value: emptyProduction(entity) }
    case 'purchase-inquiry':
    case 'inventory-count':
    case 'sale-pricing':
      return { kind: 'product-facts', value: emptyProductFacts(entity) }
    case 'purchase-inbound':
    case 'sale-return':
    case 'purchase-return':
      return { kind: 'fulfillment', value: emptyFulfillment(entity) }
    case 'intermediary-calculation':
      return { kind: 'intermediary', value: emptyIntermediary() }
    case 'opening':
      return { kind: 'opening', value: emptyOpening() }
    case 'sale-delivery':
    case 'sale-signoff':
    case 'sale-outbound':
    case 'expense-payment':
      return null
  }
}

export function cloneDocumentDraft(original: VouDetail): EditorDraft | null {
  if (original.entity === 'intermediary-calculation') {
    return {
      kind: 'intermediary',
      value: {
        ...emptyIntermediary(),
        businessDate: original.payload.businessDate,
        remark: original.payload.remark ?? '',
      },
    }
  } else if (original.entity === 'opening') {
    return {
      kind: 'opening',
      value: JSON.parse(JSON.stringify(original.payload)) as OpeningDraft,
    }
  } else if ((serviceEntities as readonly string[]).includes(original.entity)) {
    return {
      kind: 'service',
      value: cloneService(
        original.entity as ServiceEntity,
        original.payload as import('@zerp/model').VouPayloadFor<ServiceEntity>,
      ),
    }
  } else if ((billEntities as readonly string[]).includes(original.entity)) {
    return {
      kind: 'bill',
      value: cloneBill(
        original.entity as BillEntity,
        original.payload as import('@zerp/model').VouPayloadFor<BillEntity>,
        ulid,
      ),
    }
  } else if ((assetEntities as readonly string[]).includes(original.entity)) {
    const payload =
      original.payload as import('@zerp/model').VouPayloadFor<AssetEntity>
    const count =
      'assetAcquisitionLines' in payload
        ? payload.assetAcquisitionLines.length
        : 'assetSaleLines' in payload
          ? payload.assetSaleLines.length
          : payload.assetLiquidationLines.length
    return {
      kind: 'asset',
      value: cloneAsset(
        original.entity as AssetEntity,
        payload,
        Array.from({ length: count }, () => ulid()),
      ),
    }
  } else if (
    (financialEntities as readonly string[]).includes(original.entity)
  ) {
    const payload =
      original.payload as import('@zerp/model').VouPayloadFor<FinancialEntity>
    const count =
      'expenseLines' in payload
        ? payload.expenseLines.length
        : 'subunitAllocations' in payload
          ? payload.subunitAllocations.length
          : 0
    return {
      kind: 'financial',
      value: cloneFinancial(
        original.entity as FinancialEntity,
        payload,
        Array.from({ length: count }, () => ulid()),
      ),
    }
  } else if (
    (original.entity === 'order-production' ||
      original.entity === 'self-production') &&
    'productionLines' in original.payload
  ) {
    return {
      kind: 'production',
      value: cloneProduction(
        original.entity,
        original.payload,
        original.payload.productionLines.map(() => ulid()),
      ),
    }
  } else if (
    (original.entity === 'sale-pricing' ||
      original.entity === 'purchase-inquiry' ||
      original.entity === 'inventory-count') &&
    ('priceLines' in original.payload ||
      'inventoryCountLines' in original.payload)
  ) {
    const payload =
      original.payload as import('@zerp/model').VouPayloadFor<ProductFactsEntity>
    const lines =
      'priceLines' in payload ? payload.priceLines : payload.inventoryCountLines
    return {
      kind: 'product-facts',
      value: cloneProductFacts(
        original.entity,
        payload,
        lines.map(() => ulid()),
      ),
    }
  } else if (
    (original.entity === 'purchase-inbound' ||
      original.entity === 'sale-return' ||
      original.entity === 'purchase-return') &&
    'warehouse' in original.payload &&
    ('sourceLines' in original.payload || 'returnLines' in original.payload)
  ) {
    const lines =
      'sourceLines' in original.payload
        ? original.payload.sourceLines
        : original.payload.returnLines
    return {
      kind: 'fulfillment',
      value: cloneFulfillment(
        original.entity,
        original.payload,
        lines.map(() => ulid()),
      ),
    }
  } else if (
    (original.entity === 'sale-order' ||
      original.entity === 'purchase-order') &&
    'productLines' in original.payload &&
    ('customerSubunit' in original.payload || 'supplier' in original.payload)
  ) {
    return {
      kind: 'order',
      value: cloneOrder(
        original.entity,
        original.payload,
        original.payload.productLines.map(() => ulid()),
      ),
    }
  }
  return null
}
export type DocumentCommand =
  | {
      kind: 'intermediary'
      entity: 'intermediary-calculation'
      input: api.TargetVoucherInput<'intermediary-calculation'>
    }
  | {
      kind: 'service'
      entity: ServiceEntity
      input: api.TargetVoucherInput<ServiceEntity>
    }
  | {
      kind: 'order'
      entity: api.TargetOrderEntity
      input: api.TargetOrderInput<api.TargetOrderEntity>
    }
  | { kind: 'opening'; input: api.TargetOpeningInput }
  | {
      kind: 'bill'
      entity: BillEntity
      input: api.TargetVoucherInput<BillEntity>
    }
  | {
      kind: 'asset'
      entity: AssetEntity
      input: api.TargetVoucherInput<AssetEntity>
    }
  | {
      kind: 'financial'
      entity: FinancialEntity
      input: api.TargetVoucherInput<FinancialEntity>
    }
  | {
      kind: 'production'
      entity: ProductionEntity
      input: api.TargetVoucherInput<ProductionEntity>
    }
  | {
      kind: 'product-facts'
      entity: ProductFactsEntity
      input: api.TargetVoucherInput<ProductFactsEntity>
    }
  | {
      kind: 'fulfillment'
      entity: FulfillmentEntity
      input: api.TargetVoucherInput<FulfillmentEntity>
    }

export type DocumentIdentity = {
  documentId: string
  submissionId: string
  idempotencyKey: string
}
export function documentCommand(
  editor: EditorDraft,
  identity: DocumentIdentity,
): DocumentCommand {
  switch (editor.kind) {
    case 'order': {
      const value = editor.value
      return {
        kind: 'order',
        entity: value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: orderPayload(
            JSON.parse(JSON.stringify(value)) as OrderDraft,
          ),
        },
      }
    }
    case 'service': {
      const value = editor.value
      return {
        kind: 'service',
        entity: value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: servicePayload(value),
        },
      }
    }
    case 'bill': {
      const value = editor.value
      return {
        kind: 'bill',
        entity: value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: billPayload(value),
        },
      }
    }
    case 'asset': {
      const value = editor.value
      return {
        kind: 'asset',
        entity: value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: assetPayload(value),
        },
      }
    }
    case 'financial': {
      const value = editor.value
      return {
        kind: 'financial',
        entity: value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: financialPayload(value),
        },
      }
    }
    case 'production': {
      const value = editor.value
      return {
        kind: 'production',
        entity: value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: productionPayload(value),
        },
      }
    }
    case 'product-facts': {
      const value = editor.value
      return {
        kind: 'product-facts',
        entity: value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: productFactsPayload(value),
        },
      }
    }
    case 'fulfillment': {
      const value = editor.value
      return {
        kind: 'fulfillment',
        entity: value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: fulfillmentPayload(
            JSON.parse(JSON.stringify(value)) as FulfillmentDraft,
          ),
        },
      }
    }
    case 'intermediary': {
      const value = editor.value
      return {
        kind: 'intermediary',
        entity: 'intermediary-calculation',
        input: {
          ...identity,
          expectedRevision: null,
          payload: intermediaryPayload(value),
        },
      }
    }
    case 'opening': {
      const value = editor.value
      if (!value.bookId) throw new Error('请选择账簿。')
      return {
        kind: 'opening',
        input: {
          ...(JSON.parse(JSON.stringify(value)) as OpeningDraft),
          submissionId: identity.submissionId,
          idempotencyKey: identity.idempotencyKey,
        },
      }
    }
  }
}
