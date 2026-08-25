import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useWarehouseDisable,
  warehouseDisableBlockersFromError,
  warehouseDocumentEntityLabel,
  warehouseDocumentStatusLabel,
} from '@/pages/bob/warehouse/disable'
import { ApiError } from '@/api/types'
import type { BobListItem } from '@/pages/bob/shared/types'

function enabledWarehouse(): BobListItem {
  return {
    objectId: '01J00000000000000000000001',
    entity: 'warehouse',
    code: 'WHS-0001',
    objectRevision: 3,
    enabled: true,
    latestApproved: {
      approval: {
        approvalEntryId: '01J00000000000000000000002',
        versionNo: 1,
        status: 'APPROVED',
        revision: 2,
        createdBy: 'USER-1',
        createdAt: '2026-08-25T00:00:00Z',
        updatedBy: 'USER-2',
        updatedAt: '2026-08-25T00:00:00Z',
        submittedBy: 'USER-1',
        submittedAt: '2026-08-25T00:00:00Z',
        approvedBy: 'USER-2',
        approvedAt: '2026-08-25T00:00:00Z',
      },
      summary: { name: '测试仓库' },
    },
    openVersion: null,
    updatedAt: '2026-08-25T00:00:00Z',
  }
}

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

  it('extracts structured blockers only from business errors', () => {
    const blockers = {
      inventory: [],
      documents: [],
      sources: [],
      references: [],
    }
    expect(
      warehouseDisableBlockersFromError(
        new ApiError('business', 'warehouse cannot be disabled', {
          code: 3001,
          errorKey: 'warehouse_disable_blocked',
          details: blockers,
        }),
      ),
    ).toEqual(blockers)
    expect(
      warehouseDisableBlockersFromError(
        new ApiError('business', 'warehouse availability changed', {
          code: 3001,
          errorKey: 'conflict',
          details: { objectRevision: 2 },
        }),
      ),
    ).toBeNull()
    expect(
      warehouseDisableBlockersFromError(
        new ApiError('network', 'network failure', { details: blockers }),
      ),
    ).toBeNull()
  })

  it('waits for confirmation before executing disable and keeps returned blockers', async () => {
    const blockers = {
      inventory: [],
      documents: [],
      sources: [],
      references: [],
    }
    const changeEnabled = vi.fn(
      async (_row: BobListItem, handleError?: (error: unknown) => boolean) => {
        handleError?.(
          new ApiError('business', 'warehouse cannot be disabled', {
            code: 3001,
            errorKey: 'warehouse_disable_blocked',
            details: blockers,
          }),
        )
        return false
      },
    )
    const model = useWarehouseDisable(
      ref(null),
      ref(null),
      () => true,
      changeEnabled,
    )
    const warehouse = enabledWarehouse()

    await expect(model.requestChangeEnabled(warehouse)).resolves.toBe(false)
    expect(changeEnabled).not.toHaveBeenCalled()
    expect(model.warehouseDisableTarget.value?.objectId).toBe(
      warehouse.objectId,
    )

    await expect(model.confirmWarehouseDisable()).resolves.toBe(false)
    expect(changeEnabled).toHaveBeenCalledOnce()
    expect(model.warehouseDisableBlockers.value).toEqual(blockers)
    expect(model.warehouseDisableTarget.value?.objectId).toBe(
      warehouse.objectId,
    )
  })
})
