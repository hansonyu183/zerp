import { describe, expect, it } from 'vitest'
import {
  warehouseDocumentEntityLabel,
  warehouseDocumentStatusLabel,
} from '@/pages/bob/warehouse/disable'

describe('warehouse disable conflict labels', () => {
  it('maps every warehouse-blocking voucher entity to its Chinese title', () => {
    expect(
      [
        'sale-order',
        'purchase-order',
        'sale-outbound',
        'purchase-inbound',
        'sale-signoff',
        'sale-return',
        'purchase-return',
        'self-production',
        'order-production',
        'inventory-count',
      ].map(warehouseDocumentEntityLabel),
    ).toEqual([
      '销售订单',
      '采购订单',
      '销售出库',
      '采购入库',
      '销售签收',
      '销售退货',
      '采购退货',
      '生产自制品',
      '生产配货',
      '库存盘点',
    ])
  })

  it('maps blocking statuses from the closed wire contract', () => {
    expect(warehouseDocumentStatusLabel('DRAFT')).toBe('草稿')
    expect(warehouseDocumentStatusLabel('CHECKED')).toBe('已核对')
    expect(warehouseDocumentStatusLabel()).toBe('未知状态')
  })
})
