import { describe, expect, it } from 'vitest'
import type { VoucherReference } from '@/components/voucher'
import {
  deliveredQuantity,
  signoffLoss,
  validateOrderDraft,
  validateStageDraft,
} from '@/pages/wfl/intermediary-trade/validation'
import type {
  IntermediaryChildDetail,
  IntermediaryChildStage,
  IntermediaryDeliveryDraft,
  IntermediaryOrderDraft,
  IntermediaryProcurementDraft,
  IntermediaryReceiptDraft,
  IntermediarySignoffDraft,
  IntermediaryWorkflowDocument,
} from '@/pages/wfl/intermediary-trade/types'

const reference = (
  entity: string,
  code = entity.toUpperCase(),
): VoucherReference => ({
  objectId: `${entity}-object`,
  versionId: `${entity}-version`,
  entity,
  code,
  name: `${entity} name`,
})

function orderDraft(): IntermediaryOrderDraft {
  return {
    businessDate: '2026-07-26',
    currency: 'CNY',
    customer: reference('customer'),
    salesperson: reference('employee'),
    remark: '',
    productLines: [{
      key: 'line-1',
      lineId: 'LINE-1',
      product: reference('product'),
      orderedQuantity: '10',
      unitPrice: '2.50',
      containerType: 'NONE',
      quantityPerContainer: '',
      remark: '',
    }],
  }
}

function workflowDocument(): IntermediaryWorkflowDocument {
  return {
    processId: 'PROCESS-1',
    rootDocumentId: 'ROOT-1',
    documentId: 'ROOT-1',
    documentNo: 'WFL-1',
    workflowStatus: 'APPROVED',
    rootRevision: 1,
    documentRevision: 1,
    businessDate: '2026-07-26',
    currency: 'CNY',
    amount: '25.00',
    customer: reference('customer'),
    salesperson: reference('employee'),
    productLines: [{
      lineId: 'LINE-1',
      lineNo: 1,
      product: reference('product'),
      orderedQuantity: '10',
      unitPrice: '2.50',
      lineAmount: '25.00',
      containerType: 'NONE',
    }],
    balances: {
      lines: [{
        rootLineId: 'LINE-1',
        orderedQuantity: '10',
        procurementQuantity: '8',
        confirmedReceiptQuantity: '3',
        executedDeliveryQuantity: '4',
        signedQuantity: '2',
        rejectedQuantity: '1',
        lossQuantity: '1',
        availableToDeliverQuantity: '5',
        remainingToSignQuantity: '6',
      }],
      containers: [],
      hasUnfinishedChildren: true,
    },
    children: [],
    attachments: [],
    updatedAt: '2026-07-26T00:00:00Z',
  }
}

function deliveryDetail(stage: 'DELIVERY' | 'SIGNOFF'): IntermediaryChildDetail {
  const document = workflowDocument()
  return {
    documentId: 'CHILD-1',
    child: {
      childId: 'CHILD-1',
      childNo: 'CHILD-1',
      stage,
      status: 'EXECUTED',
      revision: 1,
      createdAt: '2026-07-26T00:00:00Z',
      createdBy: 'USER-1',
      updatedAt: '2026-07-26T00:00:00Z',
      updatedBy: 'USER-1',
      currency: 'CNY',
    },
    data: stage === 'DELIVERY'
      ? {
          deliveryDate: '2026-07-26',
          platform: reference('supplier'),
          vehicle: reference('vehicle'),
          expectedSolventContainers: 0,
          expectedResinContainers: 0,
        }
      : {
          deliveryChildId: 'DELIVERY-1',
          signoffDate: '2026-07-26',
          returnedSolventContainers: 0,
          returnedResinContainers: 0,
        },
    lines: stage === 'DELIVERY'
      ? [{ rootLineId: 'LINE-1', quantity: '10' }]
      : [{
          rootLineId: 'LINE-1',
          signedQuantity: '2',
          rejectedQuantity: '1',
          lossQuantity: '1',
        }],
    balances: document.balances,
    attachments: [],
  }
}

function validate(
  stage: IntermediaryChildStage,
  draft:
    | IntermediaryProcurementDraft
    | IntermediaryReceiptDraft
    | IntermediaryDeliveryDraft
    | IntermediarySignoffDraft
    | null,
  document: IntermediaryWorkflowDocument | null = workflowDocument(),
  detail: IntermediaryChildDetail | null = null,
) {
  return validateStageDraft({
    stage,
    draft,
    document,
    detail,
    signoffExpectedContainers: { solvent: 1, resin: 1 },
  })
}

describe('WFL intermediary validation', () => {
  it('accepts a valid order and rejects each required order invariant', () => {
    expect(validateOrderDraft(orderDraft())).toBeNull()

    const cases: Array<[Partial<IntermediaryOrderDraft>, string]> = [
      [{ customer: null }, '请选择客户。'],
      [{ businessDate: '' }, '请选择订购日期。'],
      [{ currency: 'cny' }, '币种必须为三位大写字母。'],
      [{ productLines: [] }, '产品明细必须为 1–200 行。'],
      [{ remark: 'x'.repeat(1001) }, '备注不能超过 1000 字。'],
    ]
    for (const [change, message] of cases) {
      expect(validateOrderDraft({ ...orderDraft(), ...change })).toBe(message)
    }

    const lineCases: Array<[Record<string, unknown>, string]> = [
      [{ product: null }, '请选择每一行的产品。'],
      [{ orderedQuantity: '-1' }, '订购数量格式不正确。'],
      [{ unitPrice: 'bad' }, '销售单价格式不正确。'],
      [
        { containerType: 'SOLVENT', quantityPerContainer: '' },
        '桶装产品必须填写大于零的每桶产品量。',
      ],
      [{ remark: 'x'.repeat(1001) }, '行备注不能超过 1000 字。'],
    ]
    for (const [change, message] of lineCases) {
      const form = orderDraft()
      form.productLines[0] = { ...form.productLines[0], ...change }
      expect(validateOrderDraft(form)).toBe(message)
    }

    const duplicate = orderDraft()
    duplicate.productLines.push({
      ...duplicate.productLines[0],
      key: 'line-2',
    })
    expect(validateOrderDraft(duplicate)).toBe('同一产品不能重复添加。')

    const tooMany = orderDraft()
    tooMany.productLines = Array.from(
      { length: 201 },
      (_, index) => ({ ...tooMany.productLines[0], key: String(index) }),
    )
    expect(validateOrderDraft(tooMany)).toBe('产品明细必须为 1–200 行。')
  })

  it('validates procurement and receipt quantities against root balances', () => {
    const procurement: IntermediaryProcurementDraft = {
      purchaseDate: '2026-07-26',
      supplier: reference('supplier'),
      purchaser: reference('employee'),
      lines: [{
        rootLineId: 'LINE-1',
        quantity: '8',
        unitPrice: '2.00',
        remark: '',
      }],
      remark: '',
    }
    expect(validate('PROCUREMENT', procurement)).toBeNull()
    expect(validate('PROCUREMENT', { ...procurement, purchaseDate: '' }))
      .toBe('请选择采购日期。')
    expect(validate('PROCUREMENT', { ...procurement, supplier: null }))
      .toBe('请选择普通供应商。')
    expect(validate('PROCUREMENT', {
      ...procurement,
      lines: [{ ...procurement.lines[0], quantity: '11' }],
    })).toBe('采购数量格式不正确或超过客户订购数量。')
    expect(validate('PROCUREMENT', {
      ...procurement,
      lines: [{ ...procurement.lines[0], quantity: '0' }],
    })).toBe('至少一行采购数量必须大于零。')
    expect(validate('PROCUREMENT', {
      ...procurement,
      lines: [{ ...procurement.lines[0], unitPrice: 'bad' }],
    })).toBe('采购单价格式不正确。')

    const receipt: IntermediaryReceiptDraft = {
      receiptDate: '2026-07-26',
      lines: [{ rootLineId: 'LINE-1', quantity: '5', remark: '' }],
      remark: '',
    }
    expect(validate('RECEIPT', receipt)).toBeNull()
    expect(validate('RECEIPT', { ...receipt, receiptDate: '' }))
      .toBe('请选择收货日期。')
    expect(validate('RECEIPT', {
      ...receipt,
      lines: [{ ...receipt.lines[0], quantity: '6' }],
    })).toBe('本次实收数量格式不正确或超过剩余采购数量。')
    expect(validate('RECEIPT', {
      ...receipt,
      lines: [{ ...receipt.lines[0], quantity: '0' }],
    })).toBe('至少一行实收数量必须大于零。')
  })

  it('validates delivery logistics, balances, and container snapshots', () => {
    const platform = reference('supplier')
    const delivery: IntermediaryDeliveryDraft = {
      deliveryDate: '2026-07-26',
      platform,
      vehicle: { ...reference('vehicle'), platformObjectId: platform.objectId },
      lines: [{ rootLineId: 'LINE-1', quantity: '5', remark: '' }],
      remark: '',
    }
    expect(validate('DELIVERY', delivery)).toBeNull()
    expect(validate('DELIVERY', { ...delivery, deliveryDate: '' }))
      .toBe('请选择送货日期。')
    expect(validate('DELIVERY', { ...delivery, vehicle: null }))
      .toBe('请选择物流平台和送货车辆。')
    expect(validate('DELIVERY', {
      ...delivery,
      vehicle: { ...reference('vehicle'), platformObjectId: 'OTHER' },
    })).toBe('送货车辆不属于所选物流平台。')
    expect(validate('DELIVERY', {
      ...delivery,
      lines: [{ ...delivery.lines[0], quantity: '6' }],
    })).toBe('本次送货数量格式不正确或超过当前可送数量。')
    expect(validate('DELIVERY', {
      ...delivery,
      lines: [{ ...delivery.lines[0], quantity: '0' }],
    })).toBe('至少一行送货数量必须大于零。')

    const document = workflowDocument()
    document.productLines[0].containerType = 'SOLVENT'
    expect(validate('DELIVERY', delivery, document))
      .toBe('无法根据包装快照计算应回收桶数。')
  })

  it('derives delivered quantities and validates signoff differences', () => {
    expect(deliveredQuantity(
      'SIGNOFF',
      deliveryDetail('DELIVERY'),
      'LINE-1',
    )).toBe('10')
    expect(deliveredQuantity(
      'SIGNOFF',
      deliveryDetail('SIGNOFF'),
      'LINE-1',
    )).toBe('4')
    const emptySignoff = deliveryDetail('SIGNOFF')
    emptySignoff.lines = []
    expect(deliveredQuantity('SIGNOFF', emptySignoff, 'LINE-1')).toBe('6')
    expect(deliveredQuantity('DELIVERY', null, 'LINE-1')).toBe('0')

    const signoff: IntermediarySignoffDraft = {
      deliveryChildId: 'DELIVERY-1',
      signoffDate: '2026-07-26',
      lines: [{
        rootLineId: 'LINE-1',
        signedQuantity: '8',
        rejectedQuantity: '1',
        remark: '',
      }],
      returnedSolventContainers: 1,
      returnedResinContainers: 1,
      containerDifferenceReason: '',
      remark: '',
    }
    const detail = deliveryDetail('DELIVERY')
    expect(validate('SIGNOFF', signoff, workflowDocument(), detail)).toBeNull()
    expect(signoffLoss('SIGNOFF', detail, signoff, 0)).toBe('1')
    expect(signoffLoss('SIGNOFF', detail, signoff, 1)).toBeNull()
    expect(validate('SIGNOFF', { ...signoff, signoffDate: '' }, undefined, detail))
      .toBe('请选择签收日期。')
    expect(validate('SIGNOFF', {
      ...signoff,
      lines: [{
        ...signoff.lines[0],
        signedQuantity: '11',
      }],
    }, undefined, detail)).toBe('签收数和拒收数格式不正确或超过送货数。')
    expect(validate('SIGNOFF', {
      ...signoff,
      returnedSolventContainers: -1,
    }, undefined, detail)).toBe('实收桶数必须为非负整数。')
    expect(validate('SIGNOFF', {
      ...signoff,
      returnedSolventContainers: 0,
    }, undefined, detail)).toBe('本次空桶少收时必须填写差异原因。')
    expect(validate('SIGNOFF', {
      ...signoff,
      returnedSolventContainers: 0,
      containerDifferenceReason: '运输途中遗失',
      remark: 'x'.repeat(1001),
    }, undefined, detail)).toBe('备注不能超过 1000 字。')
    expect(validate('SIGNOFF', null)).toBe('未加载子单草稿。')
  })
})
