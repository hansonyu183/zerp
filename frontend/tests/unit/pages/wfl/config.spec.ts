import { describe, expect, it } from 'vitest'
import {
  stageStatusText,
  workflowStageText,
  workflowStatusText,
} from '@/components/wfl/config'
import {
  lifecycleLabels,
  voucherEntityConfigs,
} from '@/pages/vou/shared/config'

describe('WFL Chinese labels', () => {
  it('translates every workflow status and preserves unknown values', () => {
    expect(
      [
        'DRAFT',
        'CHECKED',
        'APPROVED',
        'COMPLETED',
        'SHORT_CLOSE_REQUESTED',
        'SHORT_CLOSED',
        'RETURNING',
      ].map(workflowStatusText),
    ).toEqual([
      '草稿',
      '已核对',
      '已批准',
      '已完成',
      '短结待确认',
      '已短结',
      '退货处理中',
    ])
    expect(workflowStatusText('FUTURE_STATUS')).toBe('FUTURE_STATUS')
  })

  it('translates workflow stages and finalized document status', () => {
    expect(
      [
        'SALE_ORDER',
        'PRODUCTION',
        'OUTBOUND',
        'DELIVERY',
        'SIGNOFF',
        'RETURN',
        'PURCHASE_ORDER',
        'PURCHASE_INBOUND',
      ].map(workflowStageText),
    ).toEqual([
      '销售订单',
      '生产配货',
      '销售出库',
      '销售送货',
      '销售签收',
      '退货',
      '采购订单',
      '采购入库',
    ])
    expect(stageStatusText('FINALIZED')).toBe('已完成')
    expect(workflowStageText('FUTURE_STAGE')).toBe('FUTURE_STAGE')
  })
})

describe('VOU completion labels', () => {
  it('uses completion wording for all fourteen voucher types', () => {
    for (const config of Object.values(voucherEntityConfigs)) {
      expect(lifecycleLabels(config)).toMatchObject({
        finalize: '完成',
        unfinalize: '撤销完成',
        finalized: '已完成',
      })
    }
  })
})
