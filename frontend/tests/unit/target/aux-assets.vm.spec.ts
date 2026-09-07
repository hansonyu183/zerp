import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/target/api.ts'
import { useWarehouseManagementViewModel } from '@/target/pages/aux/warehouse/vm.ts'
import { useFundAccountManagementViewModel } from '@/target/pages/aux/fund-account/vm.ts'
import { useVehicleManagementViewModel } from '@/target/pages/aux/vehicle/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  createTargetWarehouse: vi.fn(),
  deleteTargetWarehouse: vi.fn(),
  createTargetFundAccount: vi.fn(),
  deleteTargetFundAccount: vi.fn(),
  createTargetVehicle: vi.fn(),
  deleteTargetVehicle: vi.fn(),
  queryTargetFundAccounts: vi.fn(),
  queryTargetVehicles: vi.fn(),
  queryTargetAuxReferences: vi.fn(),
  queryTargetEmployees: vi.fn(),
  queryTargetOperatingEntities: vi.fn(),
  queryTargetBobReferences: vi.fn(),
  queryTargetWarehouses: vi.fn(),
}))

const createWarehouse = vi.mocked(api.createTargetWarehouse)
const deleteWarehouse = vi.mocked(api.deleteTargetWarehouse)
const queryWarehouses = vi.mocked(api.queryTargetWarehouses)
const createFundAccount = vi.mocked(api.createTargetFundAccount)
const deleteFundAccount = vi.mocked(api.deleteTargetFundAccount)
const createVehicle = vi.mocked(api.createTargetVehicle)
const deleteVehicle = vi.mocked(api.deleteTargetVehicle)
const queryFundAccounts = vi.mocked(api.queryTargetFundAccounts)
const queryVehicles = vi.mocked(api.queryTargetVehicles)
const queryAuxReferences = vi.mocked(api.queryTargetAuxReferences)
const queryEmployees = vi.mocked(api.queryTargetEmployees)
const queryOperatingEntities = vi.mocked(api.queryTargetOperatingEntities)
const queryBobReferences = vi.mocked(api.queryTargetBobReferences)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function authorize(...paths: string[]) {
  const session = useTargetSession()
  session.csrfToken = 'csrf-token'
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
  session.apiPaths = paths
}

describe('AUX asset management public view-model seam', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    queryWarehouses.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never)
    queryFundAccounts.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never)
    queryVehicles.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never)
    queryEmployees.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never)
    queryOperatingEntities.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never)
  })
  it('creates a warehouse with a stable optional manager ID and no frozen snapshot', async () => {
    authorize('/aux/warehouse/create', '/aux/warehouse/query')
    createWarehouse.mockResolvedValue({ id: 'warehouse-created' } as never)
    const vm = useWarehouseManagementViewModel()
    await vm.list.initialize()
    const opening = vm.list.create()
    Object.assign(vm.editor, {
      name: ' 北仓 ',
      address: ' 北京 ',
      contactName: ' 张三 ',
      contactPhone: '13800000000',
      managerEmployeeId: 'employee-1',
      remark: ' 备注 ',
    })
    await vm.saveEditor()
    await opening
    expect(queryOperatingEntities).not.toHaveBeenCalled()
    expect(createWarehouse).toHaveBeenCalledWith('csrf-token', {
      name: '北仓',
      address: '北京',
      contactName: '张三',
      contactPhone: '13800000000',
      managerEmployeeId: 'employee-1',
      remark: '备注',
    })
  })

  it('does not request or permit a fund-account form without the exact reference permission', async () => {
    authorize('/aux/fund-account/create')
    const vm = useFundAccountManagementViewModel()
    const opening = vm.openCreate()
    await flushPromises()
    expect(queryOperatingEntities).not.toHaveBeenCalled()
    expect(vm.canSave.value).toBe(false)
    vm.closeEditor()
    await opening
  })

  it('does not apply stale operating-entity references after a new editor opens', async () => {
    authorize('/aux/fund-account/create', '/aux/operating-entity/query')
    const oldRequest =
      deferred<Awaited<ReturnType<typeof queryOperatingEntities>>>()
    queryOperatingEntities
      .mockReturnValueOnce(oldRequest.promise as never)
      .mockResolvedValueOnce({
        items: [
          {
            id: 'current-entity',
            code: 'CURRENT',
            name: '当前主体',
            enabled: true,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      } as never)
    const vm = useFundAccountManagementViewModel()
    const first = vm.openCreate()
    vm.closeEditor()
    await first
    const second = vm.openCreate()
    await flushPromises()
    oldRequest.resolve({
      items: [
        {
          id: 'stale-entity',
          code: 'STALE',
          name: '过期主体',
          enabled: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    await flushPromises()
    expect(vm.operatingEntities.value).toEqual([
      { id: 'current-entity', title: 'CURRENT · 当前主体' },
    ])
    vm.closeEditor()
    await second
  })

  it('stops operating-entity pagination after fetched rows even when disabled rows are omitted', async () => {
    authorize('/aux/fund-account/create', '/aux/operating-entity/query')
    queryOperatingEntities.mockResolvedValueOnce({
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `entity-${index}`,
        code: `E${index}`,
        name: `主体${index}`,
        enabled: index !== 0,
      })),
      total: 20,
      page: 1,
      pageSize: 20,
    } as never)
    const vm = useFundAccountManagementViewModel()
    const opening = vm.openCreate()
    await flushPromises()
    expect(queryOperatingEntities).toHaveBeenCalledTimes(1)
    expect(vm.operatingEntities.value).toHaveLength(19)
    vm.closeEditor()
    await opening
  })

  it('submits an external vehicle carrier with the selected exact approval entry', async () => {
    authorize(
      '/aux/vehicle/create',
      '/aux/reference/query',
      '/aux/operating-entity/query',
      '/bob/reference/query',
    )
    queryAuxReferences.mockResolvedValue([
      { objectId: 'type-1', code: '货车' },
    ] as never)
    queryOperatingEntities.mockResolvedValue({
      items: [{ id: 'ope-1', code: 'OPE', name: '经营主体', enabled: true }],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    queryBobReferences.mockResolvedValue([
      {
        objectId: 'unit-1',
        sourceApprovalEntryId: 'approval-1',
        code: 'OUT',
        name: '外部单位',
        sourceVersionNo: 1,
      },
    ] as never)
    createVehicle.mockResolvedValue({ id: 'vehicle-created' } as never)
    const vm = useVehicleManagementViewModel()
    const opening = vm.openCreate()
    await flushPromises()
    Object.assign(vm.editor, {
      name: ' 运输车 ',
      plateNumber: ' 京A12345 ',
      vehicleTypeId: 'type-1',
      carrierKind: 'EXTERNAL',
      carrierOtherUnitId: 'unit-1',
      ratedLoadKg: '1500',
      vin: ' VIN ',
      engineNumber: ' ENG ',
      bulkWaterCarrier: true,
      remark: ' 备注 ',
    })
    await vm.saveEditor()
    await opening
    expect(createVehicle).toHaveBeenCalledWith(
      'csrf-token',
      expect.objectContaining({
        carrier: {
          kind: 'EXTERNAL',
          otherUnitId: 'unit-1',
          approvalEntryId: 'approval-1',
        },
        ratedLoadKg: 1500,
      }),
    )
  })

  it('blocks stale or unknown saves without erasing the fund-account temporary input', async () => {
    authorize('/aux/fund-account/create', '/aux/operating-entity/query')
    queryOperatingEntities.mockResolvedValue({
      items: [{ id: 'ope-1', code: 'OPE', name: '经营主体', enabled: true }],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    createFundAccount.mockRejectedValue(
      new api.TargetApiError('conflict', 'conflict', 'request-1'),
    )
    const vm = useFundAccountManagementViewModel()
    const opening = vm.openCreate()
    await flushPromises()
    Object.assign(vm.editor, {
      name: '账户',
      currency: 'CNY',
      accountName: '户名',
      bank: '银行',
      accountNumber: '123',
      operatingEntityId: 'ope-1',
    })
    await vm.saveEditor()
    await vm.saveEditor()
    expect(vm.editor.name).toBe('账户')
    expect(vm.canSave.value).toBe(false)
    expect(createFundAccount).toHaveBeenCalledTimes(1)
    vm.closeEditor()
    await opening
  })

  it('rejects an unknown vehicle save once and destroys temporary input on disposal', async () => {
    authorize(
      '/aux/vehicle/create',
      '/aux/reference/query',
      '/aux/operating-entity/query',
      '/bob/reference/query',
    )
    queryAuxReferences.mockResolvedValue([
      { objectId: 'type-1', code: '货车' },
    ] as never)
    queryOperatingEntities.mockResolvedValue({
      items: [{ id: 'ope-1', code: 'OPE', name: '经营主体', enabled: true }],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    queryBobReferences.mockResolvedValue([] as never)
    createVehicle.mockRejectedValue(new TypeError('network'))
    const vm = useVehicleManagementViewModel()
    const opening = vm.openCreate()
    const rejected = expect(opening).rejects.toThrow('请求结果未知')
    await flushPromises()
    Object.assign(vm.editor, {
      name: '待核实车辆',
      plateNumber: '京A1',
      vehicleTypeId: 'type-1',
      carrierKind: 'INTERNAL',
      carrierOperatingEntityId: 'ope-1',
      ratedLoadKg: '0',
    })
    await vm.saveEditor()
    await rejected
    expect(vm.editor.name).toBe('待核实车辆')
    expect(vm.canSave.value).toBe(false)
    await vm.saveEditor()
    expect(createVehicle).toHaveBeenCalledTimes(1)
    vm.dispose()
    expect(vm.editorOpen.value).toBe(false)
    expect(vm.editor.name).toBe('')
  })

  it('deletes each asset with its row revision and locks an unknown delete', async () => {
    const row = {
      id: 'asset-1',
      code: 'AST-1',
      py: 'asset',
      name: '资产',
      enabled: true,
      revision: 'revision-1',
      availableActions: ['delete'],
    } as never

    authorize('/aux/warehouse/delete')
    deleteWarehouse.mockResolvedValue({ deleted: true } as never)
    const warehouse = useWarehouseManagementViewModel()
    await warehouse.list.delete(row)
    expect(deleteWarehouse).toHaveBeenCalledWith('csrf-token', {
      id: 'asset-1',
      revision: 'revision-1',
    })

    authorize('/aux/fund-account/delete')
    deleteFundAccount.mockResolvedValue({ deleted: true } as never)
    const fundAccount = useFundAccountManagementViewModel()
    await fundAccount.list.delete(row)
    expect(deleteFundAccount).toHaveBeenCalledWith('csrf-token', {
      id: 'asset-1',
      revision: 'revision-1',
    })

    authorize('/aux/vehicle/delete')
    deleteVehicle.mockRejectedValue(
      new api.TargetApiError('invalid_response', 'invalid', 'request-1'),
    )
    const vehicle = useVehicleManagementViewModel()
    await vehicle.list.delete(row)
    await vehicle.list.delete(row)
    expect(deleteVehicle).toHaveBeenCalledTimes(1)
    expect(vehicle.list.isRowBlocked('asset-1')).toBe(true)
  })
})
