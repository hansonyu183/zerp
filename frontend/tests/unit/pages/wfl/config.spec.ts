import { describe, expect, it } from 'vitest'
import {
  definitionStatusText,
  documentEntityText,
  runtimeEventText,
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

  it('translates definition-list and instance-list values', () => {
    expect(['DRAFT', 'ENABLED', 'DISABLED'].map(definitionStatusText)).toEqual([
      '草稿',
      '已启用',
      '已停用',
    ])
    expect(
      ['sale-order', 'purchase-inbound', 'expense-payment'].map(
        documentEntityText,
      ),
    ).toEqual(['销售订单', '采购入库', '费用付款'])
    expect(['STARTED', 'CHILD_CREATED'].map(runtimeEventText)).toEqual([
      '流程已启动',
      '已创建下级单据',
    ])
    expect(documentEntityText('future-document')).toBe('future-document')
    expect(definitionStatusText('FUTURE_STATUS')).toBe('FUTURE_STATUS')
    expect(runtimeEventText('FUTURE_EVENT')).toBe('FUTURE_EVENT')
  })
})

describe('VOU completion labels', () => {
  it('uses completion wording with inventory count business labels', () => {
    for (const config of Object.values(voucherEntityConfigs)) {
      expect(lifecycleLabels(config)).toMatchObject(
        config.entity === 'inventory-count'
          ? {
              finalize: '完成盘点',
              unfinalize: '撤销盘点',
              finalized: '已盘点',
            }
          : {
              finalize: '完成',
              unfinalize: '撤销完成',
              finalized: '已完成',
            },
      )
    }
  })
})
