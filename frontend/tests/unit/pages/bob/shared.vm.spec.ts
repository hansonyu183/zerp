import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { getBobEntityConfig, statusOptions } from '@/pages/bob/shared/config'
import { useBobEntityViewModel } from '@/pages/bob/shared/vm'
import type {
  BobListItem,
  BobObjectView,
  BobStatus,
} from '@/pages/bob/shared/types'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    postContract: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

function row(status: BobStatus = 'DRAFT', enabled = true): BobListItem {
  const approval = {
    approvalEntryId: 'VER-1',
    versionNo: status === 'APPROVED' ? 2 : 1,
    status,
    revision: 5,
    createdBy: 'USER-0',
    createdAt: '2026-07-24T09:00:00Z',
    updatedBy: 'USER-0',
    updatedAt: '2026-07-24T10:00:00Z',
    submittedBy: status === 'PENDING' ? 'USER-2' : null,
    submittedAt: status === 'PENDING' ? '2026-07-24T09:30:00Z' : null,
    approvedBy: status === 'APPROVED' ? 'USER-2' : null,
    approvedAt: status === 'APPROVED' ? '2026-07-24T09:45:00Z' : null,
  }
  const version = {
    approval,
    summary: {
      name: '标准产品',
      productTypeId: 'TYPE-RAW',
      behaviorProfile: 'RAW_MATERIAL',
      defaultInputUnitId: 'UNIT-PIECE',
      pricingUnitId: 'UNIT-KG',
      unitConversions: [
        { unit: { objectId: 'UNIT-PIECE' }, factor: '1' },
        { unit: { objectId: 'UNIT-KG' }, factor: '1' },
      ],
      returnable: false,
      defaultPackagingSpec: '1',
      categoryId: '',
      specification: '',
      model: 'M1',
      barcode: '',
      remark: '',
    },
  } satisfies NonNullable<BobListItem['openVersion']>
  return {
    objectId: 'OBJ-1',
    entity: 'product',
    code: 'PRD-1',
    objectRevision: 3,
    enabled,
    latestApproved: status === 'APPROVED' ? version : null,
    openVersion: status === 'APPROVED' ? null : version,
    updatedAt: '2026-07-24T10:00:00Z',
  }
}

function objectView(approvalEntryId = 'VER-1'): BobObjectView {
  return {
    objectId: 'OBJ-1',
    entity: 'product',
    code: 'PRD-1',
    objectRevision: 4,
    enabled: true,
    updatedAt: '2026-07-24T10:00:00Z',
    approval: {
      approvalEntryId: approvalEntryId,
      versionNo: 2,
      status: 'DRAFT',
      revision: 1,
      createdBy: 'USER-0',
      createdAt: '2026-07-24T09:00:00Z',
      updatedBy: 'USER-0',
      updatedAt: '2026-07-24T10:00:00Z',
      submittedBy: null,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
    },
    data: {
      name: '标准产品',
      productTypeId: 'TYPE-RAW',
      behaviorProfile: 'RAW_MATERIAL',
      defaultInputUnitId: 'UNIT-PIECE',
      pricingUnitId: 'UNIT-KG',
      unitConversions: [
        { unit: { objectId: 'UNIT-PIECE' }, factor: '1' },
        { unit: { objectId: 'UNIT-KG' }, factor: '1' },
      ],
      returnable: false,
      defaultPackagingSpec: '1',
      categoryId: '',
      specification: '',
      model: 'M1',
      barcode: '',
      remark: '',
    },
  }
}

function grant(entity: string, ...actions: string[]) {
  useSessionStore().permissions = [
    ...actions.map((action) => `/bob/${entity}/${action}`),
    ...(entity === 'product'
      ? [
          '/bob/product/query',
          '/aux/product-type/query',
          '/aux/measurement-unit/query',
          '/aux/product-category/query',
        ]
      : []),
  ]
}

describe('shared BOB entity configuration and view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('通过对象深链接标识仅打开 BOB current 详情', async () => {
    grant('product', 'get', 'save')
    mockedApiClient.postContract.mockResolvedValueOnce({ data: objectView() })
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    await vm.openById('OBJ-1', 'edit')

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/product/get',
      {
        objectId: 'OBJ-1',
      },
    )
    expect(vm.drawerOpen.value).toBe(true)
    expect(vm.editorMode.value).toBe('view')
    expect(vm.currentView.value?.approval.revision).toBe(1)

    vm.closeEditor()
    expect(vm.drawerOpen.value).toBe(false)
    expect(vm.currentView.value).toBeNull()
  })

  it('详情请求失败时不展示默认值空抽屉', async () => {
    grant('product', 'get')
    mockedApiClient.postContract.mockRejectedValueOnce(
      new Error('详情加载失败'),
    )
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    await vm.openView(row())

    expect(vm.drawerOpen.value).toBe(false)
    expect(vm.currentView.value).toBeNull()
    expect(vm.editorErrorMessage.value).toBe('详情加载失败')
  })

  it('当前档案使用只读列和启停筛选', () => {
    const expectedColumns: Record<string, string[]> = {
      product: [
        '编码',
        '名称',
        '产品类型',
        '默认录入单位',
        '型号',
        'Stable ID',
        '来源 Approval Entry ID',
        '启停状态',
      ],
      warehouse: [
        '编码',
        '名称',
        '仓库负责人',
        '地址',
        '联系人',
        'Stable ID',
        '来源 Approval Entry ID',
        '启停状态',
      ],
      vehicle: [
        '编码',
        '名称',
        '车牌',
        '车型',
        '承运归属',
        'VIN',
        '核定载重（kg）',
        '支持散水承运',
        'Stable ID',
        '来源 Approval Entry ID',
        '启停状态',
      ],
      'fund-account': [
        '编码',
        '名称',
        '币种',
        '银行',
        '经营主体',
        'Stable ID',
        '来源 Approval Entry ID',
        '启停状态',
      ],
      'operating-entity': [
        '编码',
        '法定公司名称',
        '税号',
        'Stable ID',
        '来源 Approval Entry ID',
        '启停状态',
      ],
    }

    for (const [entity, columns] of Object.entries(expectedColumns)) {
      const config = getBobEntityConfig(entity)
      expect(config.entity).toBe(entity)
      expect(config.detailKeys).toContain('name')
      expect(config.columns.map((column) => column.label)).toEqual(columns)
      if (
        entity === 'operating-entity' ||
        entity === 'warehouse' ||
        entity === 'vehicle' ||
        entity === 'fund-account' ||
        entity === 'product'
      ) {
        expect(config.filters.map((filter) => filter.key)).toEqual(['enabled'])
      } else {
        expect(config.filters[0]).toMatchObject({
          key: 'status',
          multiple: true,
        })
      }
    }
    expect(statusOptions).toHaveLength(3)
  })

  it('专用工作区、迁出的辅助对象和员工不再注册为通用 BOB 页面', () => {
    for (const entity of [
      'supplier',
      'category',
      'department',
      'position',
      'employee',
    ]) {
      expect(() => getBobEntityConfig(entity)).toThrow()
    }
  })

  it('BOB 经营主体只读取当前投影且忽略 DCL 生命周期权限', async () => {
    useSessionStore().permissions = [
      '/bob/operating-entity/query',
      '/bob/operating-entity/get',
      '/bob/operating-entity/create',
      '/bob/operating-entity/save',
      '/bob/operating-entity/submit',
      '/bob/operating-entity/approve',
      '/bob/operating-entity/versions',
      '/dcl/operating-entity/create',
      '/dcl/operating-entity/approve',
    ]
    const approval = row('APPROVED').latestApproved!.approval
    mockedApiClient.postContract.mockResolvedValueOnce({
      data: {
        items: [
          {
            objectId: 'OPE-OBJECT-1',
            entity: 'operating-entity',
            code: 'OPE-0001',
            objectRevision: 1,
            enabled: true,
            latestApproved: {
              approval,
              summary: {
                name: '当前经营主体',
                shortName: '当前主体',
                taxNumber: '91310000DCL',
                address: '',
                phone: '',
                remark: '',
              },
            },
            openVersion: null,
            updatedAt: '2026-08-27T06:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = useBobEntityViewModel(getBobEntityConfig('operating-entity'))

    await vm.query()

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/operating-entity/query',
      {
        page: 1,
        pageSize: 20,
        filters: {},
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    expect(vm.rows.value[0]?.latestApproved?.summary).toMatchObject({
      name: '当前经营主体',
      taxNumber: '91310000DCL',
    })
    expect(vm.canView()).toBe(true)
    expect('save' in vm).toBe(false)
  })

  it('BOB 仓库只读取当前投影且没有任何写动作', async () => {
    useSessionStore().permissions = [
      '/bob/warehouse/query',
      '/bob/warehouse/get',
      '/dcl/warehouse/create',
      '/dcl/warehouse/approve',
    ]
    const approval = row('APPROVED').latestApproved!.approval
    mockedApiClient.postContract.mockResolvedValueOnce({
      data: {
        items: [
          {
            objectId: 'WHS-OBJECT-1',
            entity: 'warehouse',
            code: 'WHS-0001',
            objectRevision: 1,
            enabled: true,
            latestApproved: {
              approval,
              summary: {
                name: '当前仓库',
                address: '上海',
                contactName: '仓管员',
                contactPhone: '12345',
                managerEmployeeId: 'EMP-1',
                remark: '',
              },
            },
            openVersion: null,
            updatedAt: '2026-08-27T06:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = useBobEntityViewModel(getBobEntityConfig('warehouse'))

    await vm.query()

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/warehouse/query',
      {
        page: 1,
        pageSize: 20,
        filters: {},
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    expect(vm.rows.value[0]?.latestApproved?.summary.name).toBe('当前仓库')
    expect(vm.canView()).toBe(true)
    expect('submitObject' in vm).toBe(false)
  })

  it('BOB 车辆只读取当前投影且没有任何写动作', async () => {
    useSessionStore().permissions = [
      '/bob/vehicle/query',
      '/bob/vehicle/get',
      '/bob/vehicle/create',
      '/bob/vehicle/save',
      '/bob/vehicle/submit',
      '/bob/vehicle/approve',
      '/bob/vehicle/enable',
      '/dcl/vehicle/create',
      '/dcl/vehicle/approve',
    ]
    const approval = row('APPROVED').latestApproved!.approval
    mockedApiClient.postContract.mockResolvedValueOnce({
      data: {
        items: [
          {
            objectId: 'VEH-OBJECT-1',
            entity: 'vehicle',
            code: 'VEH-0001',
            objectRevision: 1,
            enabled: true,
            latestApproved: {
              approval,
              summary: {
                name: '当前车辆',
                plateNumber: '沪A12345',
                vehicleType: 'DIT-0003',
                carrierAffiliation: {
                  type: 'INTERNAL',
                  operatingEntityId: 'OPE-1',
                },
                vin: 'LDC613P23A1305189',
                loadCapacityKg: '5000.000',
                bulkLiquidCapable: true,
              },
            },
            openVersion: null,
            updatedAt: '2026-08-28T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = useBobEntityViewModel(getBobEntityConfig('vehicle'))

    await vm.query()

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/vehicle/query',
      {
        page: 1,
        pageSize: 20,
        filters: {},
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    expect(vm.rows.value[0]?.latestApproved?.summary.name).toBe('当前车辆')
    expect(vm.canView()).toBe(true)
    expect('changeEnabled' in vm).toBe(false)
  })

  it('BOB 产品只读取当前投影且忽略全部生命周期权限', () => {
    grant('product', 'submit', 'approve')
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    expect(vm.canView()).toBe(false)
    expect('submitObject' in vm).toBe(false)
    expect('review' in vm).toBe(false)

    useSessionStore().permissions.push('/bob/product/get')
    expect(vm.canView()).toBe(true)
  })

  it('分页变化时重新查询并保持固定页大小', async () => {
    grant('product', 'query')
    mockedApiClient.postContract.mockResolvedValueOnce({
      data: { items: [], total: 0, page: 2, pageSize: 20 },
    })
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    await vm.changePage(2)

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/product/query',
      expect.objectContaining({ page: 2, pageSize: 20 }),
    )
  })

  it('BOB 产品不会因遗留写权限暴露任何操作', () => {
    grant(
      'product',
      'get',
      'save',
      'delete',
      'submit',
      'unsubmit',
      'approve',
      'unapprove',
      'reject',
      'enable',
      'disable',
      'versions',
      'audit-history',
    )
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    expect(vm.canView()).toBe(true)
    expect('openEdit' in vm).toBe(false)
    expect('deleteObject' in vm).toBe(false)
    expect('submitObject' in vm).toBe(false)
    expect('review' in vm).toBe(false)
    expect('openVersions' in vm).toBe(false)
  })

  it('资金账户当前档案不提供 BOB 写入或经营主体引用预载', async () => {
    grant('fund-account', 'create', 'get', 'save', 'query')
    const config = getBobEntityConfig('fund-account')
    const vm = useBobEntityViewModel(config)
    expect(vm.drawerOpen.value).toBe(false)
    expect(vm.canView()).toBe(true)
    expect('openCreate' in vm).toBe(false)
    expect('save' in vm).toBe(false)
    expect(mockedApiClient.postContract).not.toHaveBeenCalled()
  })

  it('查看资金账户当前档案不会预载经营主体引用', async () => {
    grant('fund-account', 'get')
    const config = getBobEntityConfig('fund-account')
    mockedApiClient.postContract.mockResolvedValueOnce({
      data: {
        objectId: 'FND-1',
        entity: 'fund-account',
        code: 'FA-0001',
        objectRevision: 1,
        enabled: true,
        updatedAt: '2026-08-28T00:00:00Z',
        approval: {
          approvalEntryId: 'VER-1',
          versionNo: 1,
          status: 'APPROVED',
          revision: 1,
          createdBy: 'USER-1',
          createdAt: '2026-08-28T00:00:00Z',
          updatedBy: 'USER-1',
          updatedAt: '2026-08-28T00:00:00Z',
          submittedBy: 'USER-1',
          submittedAt: '2026-08-28T00:00:00Z',
          approvedBy: 'USER-2',
          approvedAt: '2026-08-28T00:00:00Z',
        },
        data: {
          name: '基本户',
          currency: 'CNY',
          operatingEntityId: 'OPE-1',
        },
      },
    })
    const vm = useBobEntityViewModel(config)

    await vm.openView({ ...row(), entity: 'fund-account', objectId: 'FND-1' })

    expect(mockedApiClient.postContract).toHaveBeenCalledTimes(1)
    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/fund-account/get',
      { objectId: 'FND-1' },
    )
  })
})
