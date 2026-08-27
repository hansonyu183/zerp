import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useWarehouseDisable,
  warehouseDisableBlockersFromError,
  warehouseDocumentEntityLabel,
  warehouseDocumentStatusLabel,
} from '@/pages/dcl/warehouse/disable'
import { ApiError } from '@/api/types'
import type { DclWarehouseListItem } from '@/pages/dcl/warehouse/types'

function enabledWarehouse(openVersionEnabled?: boolean): DclWarehouseListItem {
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
      data: { name: '测试仓库' },
      enabled: true,
    },
    openVersion:
      openVersionEnabled === undefined
        ? null
        : {
            approval: {
              approvalEntryId: '01J00000000000000000000003',
              versionNo: 2,
              status: 'PENDING',
              revision: 1,
              createdBy: 'USER-1',
              createdAt: '2026-08-25T00:00:00Z',
              updatedBy: 'USER-1',
              updatedAt: '2026-08-25T00:00:00Z',
              submittedBy: 'USER-1',
              submittedAt: '2026-08-25T00:00:00Z',
              approvedBy: null,
              approvedAt: null,
            },
            data: { name: '测试仓库' },
            enabled: openVersionEnabled,
          },
    updatedAt: '2026-08-25T00:00:00Z',
  }
}

describe('DCL warehouse disable request', () => {
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

  it('extracts structured blockers only from warehouse disable business errors', () => {
    const blockers = {
      inventory: [],
      documents: [],
      sources: [],
      references: [],
    }
    expect(warehouseDocumentStatusLabel('DRAFT')).toBe('草稿')
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
  })

  it('confirmation only creates a DCL disable draft', async () => {
    const changeEnabled = vi.fn(async () => true)
    const model = useWarehouseDisable(
      ref(null),
      ref(null),
      () => true,
      changeEnabled,
    )
    const warehouse = enabledWarehouse()

    await expect(model.requestChangeEnabled(warehouse)).resolves.toBe(false)
    expect(changeEnabled).not.toHaveBeenCalled()
    await expect(model.confirmWarehouseDisable()).resolves.toBe(true)
    expect(changeEnabled).toHaveBeenCalledWith(warehouse)
    expect(model.warehouseDisableTarget.value).toBeNull()
    expect(model.warehouseDisableBlockers.value).toBeNull()
  })

  it('keeps rich blockers for approval of a disabled open candidate only', () => {
    const blockers = {
      inventory: [],
      documents: [],
      sources: [],
      references: [],
    }
    const changeEnabled = vi.fn(async () => true)
    const model = useWarehouseDisable(
      ref(null),
      ref(null),
      () => true,
      changeEnabled,
    )
    const blocked = enabledWarehouse(false)
    const error = new ApiError('business', 'warehouse cannot be disabled', {
      code: 3001,
      errorKey: 'warehouse_disable_blocked',
      details: blockers,
    })

    expect(model.handleWarehouseDisableApprovalError(blocked, error)).toBe(true)
    expect(model.warehouseDisableBlockers.value).toEqual(blockers)
    expect(model.warehouseDisableTarget.value?.objectId).toBe(blocked.objectId)
    expect(
      model.handleWarehouseDisableApprovalError(enabledWarehouse(true), error),
    ).toBe(false)
    expect(
      model.handleWarehouseDisableApprovalError(enabledWarehouse(), error),
    ).toBe(false)
  })
})
