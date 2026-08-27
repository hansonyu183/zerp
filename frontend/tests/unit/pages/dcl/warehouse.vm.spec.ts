import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import type { DclWarehouseListItem } from '@/pages/dcl/warehouse/types'
import { useDclWarehouseViewModel } from '@/pages/dcl/warehouse/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn(), setCsrfToken: vi.fn() },
}))

const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: 'ENTRY-1',
  versionNo: 1,
  status: 'APPROVED' as const,
  revision: 2,
  createdBy: 'USER-1',
  createdAt: '2026-08-27T06:00:00Z',
  updatedBy: 'USER-1',
  updatedAt: '2026-08-27T06:00:00Z',
  submittedBy: 'USER-2',
  submittedAt: '2026-08-27T06:30:00Z',
  approvedBy: 'USER-2',
  approvedAt: '2026-08-27T07:00:00Z',
}

const warehouseData = {
  name: '测试仓库',
  address: '上海市浦东新区',
  contactName: '仓管员',
  contactPhone: '+86 21 12345678',
  managerEmployeeId: 'EMP-1',
  remark: '常温库',
}

function row(enabled = true): DclWarehouseListItem {
  return {
    objectId: 'OBJECT-1',
    entity: 'warehouse',
    code: 'WHS-0001',
    objectRevision: 1,
    enabled,
    latestApproved: { approval, data: warehouseData, enabled },
    openVersion: null,
    updatedAt: '2026-08-27T06:00:00Z',
  }
}

function emptyPage() {
  return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
}

describe('DCL warehouse view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('queries only DCL candidates with the typed warehouse snapshot', async () => {
    useSessionStore().permissions = ['/dcl/warehouse/query']
    mockedPost.mockResolvedValueOnce({
      data: { items: [row()], total: 1, page: 1, pageSize: 20 },
    })
    const vm = useDclWarehouseViewModel()

    await vm.query()

    expect(mockedPost).toHaveBeenCalledWith('dcl/warehouse/query', {
      page: 1,
      pageSize: 20,
      filters: {},
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(vm.rows.value[0]?.latestApproved?.data).toEqual(warehouseData)
  })

  it('creates and submits an enabled change through DCL only', async () => {
    useSessionStore().permissions = [
      '/dcl/warehouse/query',
      '/dcl/warehouse/create',
      '/dcl/warehouse/get',
      '/dcl/warehouse/save',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: {
          objectId: 'OBJECT-1',
          objectRevision: 1,
          enabled: true,
          approval,
        },
      })
      .mockResolvedValueOnce(emptyPage())
    const vm = useDclWarehouseViewModel()

    vm.openCreate()
    await expect(
      vm.save({
        ...vm.config.emptyForm(),
        name: ' 新仓库 ',
        address: ' 上海 ',
        contactName: ' 联系人 ',
        contactPhone: ' 12345 ',
        managerEmployeeId: ' EMP-1 ',
        remark: ' 备注 ',
      }),
    ).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/warehouse/create', {
      data: {
        name: '新仓库',
        address: '上海',
        contactName: '联系人',
        contactPhone: '12345',
        managerEmployeeId: 'EMP-1',
        remark: '备注',
      },
    })

    vi.clearAllMocks()
    mockedPost
      .mockResolvedValueOnce({
        data: {
          objectId: 'OBJECT-1',
          entity: 'warehouse',
          code: 'WHS-0001',
          objectRevision: 1,
          enabled: true,
          approval,
          data: warehouseData,
          updatedAt: '2026-08-27T06:00:00Z',
        },
      })
      .mockResolvedValueOnce({ data: { objectId: 'OBJECT-1' } })
      .mockResolvedValueOnce(emptyPage())
    await expect(vm.changeEnabled(row())).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/warehouse/get', {
      objectId: 'OBJECT-1',
      approvalEntryId: 'ENTRY-1',
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/warehouse/save', {
      objectId: 'OBJECT-1',
      approvalEntryId: 'ENTRY-1',
      approvalRevision: 2,
      enabled: false,
      data: warehouseData,
    })
    expect(
      mockedPost.mock.calls.some(([path]) => String(path).startsWith('bob/')),
    ).toBe(false)
  })

  it('shows rich blockers only when approving a disabled warehouse candidate', async () => {
    useSessionStore().permissions = ['/dcl/warehouse/approve']
    const disabledCandidate: DclWarehouseListItem = {
      ...row(),
      openVersion: {
        approval: {
          ...approval,
          approvalEntryId: 'ENTRY-2',
          versionNo: 2,
          status: 'PENDING',
          submittedBy: 'USER-2',
        },
        data: warehouseData,
        enabled: false,
      },
    }
    const blockers = {
      inventory: [],
      documents: [],
      sources: [],
      references: [],
    }
    mockedPost.mockRejectedValueOnce(
      new ApiError('business', 'warehouse cannot be disabled', {
        code: 3001,
        errorKey: 'warehouse_disable_blocked',
        details: blockers,
      }),
    )
    const vm = useDclWarehouseViewModel()

    await expect(vm.review(disabledCandidate, 'approve', '')).resolves.toBe(
      false,
    )

    expect(vm.warehouseDisableBlockers.value).toEqual(blockers)
    expect(vm.warehouseDisableTarget.value?.objectId).toBe('OBJECT-1')
    expect(vm.errorMessage.value).toBeNull()
  })

  it('keeps normal approve errors in the standard message channel', async () => {
    useSessionStore().permissions = ['/dcl/warehouse/approve']
    const enabledCandidate: DclWarehouseListItem = {
      ...row(),
      openVersion: {
        approval: {
          ...approval,
          approvalEntryId: 'ENTRY-2',
          versionNo: 2,
          status: 'PENDING',
          submittedBy: 'USER-2',
        },
        data: warehouseData,
        enabled: true,
      },
    }
    mockedPost.mockRejectedValueOnce(
      new ApiError('business', 'approval conflict', {
        code: 3001,
        errorKey: 'conflict',
      }),
    )
    const vm = useDclWarehouseViewModel()

    await expect(vm.review(enabledCandidate, 'approve', '')).resolves.toBe(
      false,
    )

    expect(vm.warehouseDisableBlockers.value).toBeNull()
    expect(vm.warehouseDisableTarget.value).toBeNull()
    expect(vm.errorMessage.value).toContain('当前数据状态不允许此操作')
  })
})
