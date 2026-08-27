import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclVehicleViewModel } from '@/pages/dcl/vehicle/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: 'VER-1',
  versionNo: 1,
  status: 'DRAFT' as const,
  revision: 2,
  createdBy: 'USER-1',
  createdAt: '2026-08-28T00:00:00Z',
  updatedBy: 'USER-1',
  updatedAt: '2026-08-28T00:00:00Z',
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
}

const vehicleView = {
  objectId: 'VEH-1',
  entity: 'vehicle' as const,
  code: 'VEH-0001',
  objectRevision: 1,
  enabled: true,
  approval,
  data: {
    name: '配送车',
    plateNumber: '沪A12345',
    vehicleType: 'DIT-0003',
    carrierAffiliation: {
      type: 'INTERNAL' as const,
      operatingEntityId: 'OPE-1',
    },
    bulkLiquidCapable: false,
  },
  updatedAt: '2026-08-28T00:00:00Z',
}

function vehicleForm() {
  return {
    code: '',
    name: '配送车',
    plateNumber: '沪A12345',
    vehicleType: 'DIT-0003',
    carrierType: 'INTERNAL' as const,
    carrierOperatingEntityId: 'OPE-1',
    carrierServiceRelationshipObjectId: '',
    bulkLiquidCapable: false,
    vin: '',
    engineNumber: '',
    loadCapacityKg: '',
    remark: '',
  }
}

describe('DCL vehicle view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('queries and submits the DCL candidate without using BOB writes', async () => {
    useSessionStore().permissions = [
      '/dcl/vehicle/query',
      '/dcl/vehicle/submit',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              objectId: 'VEH-1',
              entity: 'vehicle',
              code: 'VEH-0001',
              objectRevision: 1,
              enabled: true,
              latestApproved: null,
              openVersion: {
                approval,
                enabled: true,
                data: {
                  name: '配送车',
                  plateNumber: '沪A12345',
                  vehicleType: 'DIT-0003',
                  carrierAffiliation: {
                    type: 'INTERNAL',
                    operatingEntityId: 'OPE-1',
                  },
                  bulkLiquidCapable: false,
                },
              },
              updatedAt: '2026-08-28T00:00:00Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclVehicleViewModel()

    await vm.query()
    await expect(vm.submitObject(vm.rows.value[0]!)).resolves.toBe(true)

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/vehicle/query', {
      page: 1,
      pageSize: 20,
      filters: {},
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/vehicle/submit', {
      objectId: 'VEH-1',
      approvalEntryId: 'VER-1',
      approvalRevision: 2,
    })
    expect(
      mockedPost.mock.calls.flatMap(([path]) => String(path)),
    ).not.toContain('bob/vehicle')
  })

  it('serializes exactly one closed carrier affiliation branch', async () => {
    useSessionStore().permissions = [
      '/dcl/vehicle/create',
      '/aux/dictionary-item/query',
      '/bob/operating-entity/query',
      '/bob/other-unit/query',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclVehicleViewModel()
    vm.openCreate()

    await expect(
      vm.save({
        ...vm.editorModel.value,
        name: '外部承运车',
        plateNumber: '沪A12345',
        vehicleType: 'DIT-0003',
        carrierType: 'EXTERNAL',
        carrierOperatingEntityId: 'STALE',
        carrierServiceRelationshipObjectId: 'SERVICE-1',
        bulkLiquidCapable: true,
      }),
    ).resolves.toBe(true)

    expect(mockedPost).toHaveBeenNthCalledWith(3, 'dcl/vehicle/create', {
      data: {
        name: '外部承运车',
        plateNumber: '沪A12345',
        vehicleType: 'DIT-0003',
        carrierAffiliation: {
          type: 'EXTERNAL',
          serviceRelationshipObjectId: 'SERVICE-1',
        },
        bulkLiquidCapable: true,
      },
    })
  })

  it.each([
    ['operating entity', '/bob/operating-entity/query'],
    ['other unit', '/bob/other-unit/query'],
  ])(
    'prevents create, deep-link edit, and save without %s reference permission',
    async (_name, missingPermission) => {
      useSessionStore().permissions = [
        '/dcl/vehicle/create',
        '/dcl/vehicle/get',
        '/dcl/vehicle/save',
        '/aux/dictionary-item/query',
        '/bob/operating-entity/query',
        '/bob/other-unit/query',
      ].filter((permission) => permission !== missingPermission)
      mockedPost.mockResolvedValue({ data: vehicleView })
      const vm = useDclVehicleViewModel()

      vm.openCreate()

      expect(vm.canCreate.value).toBe(false)
      expect(vm.drawerOpen.value).toBe(false)
      await expect(vm.save(vehicleForm())).resolves.toBe(false)

      await vm.openById('VEH-1', 'edit')

      expect(vm.editorMode.value).toBe('view')
      await expect(vm.save(vehicleForm())).resolves.toBe(false)
      expect(mockedPost.mock.calls.map(([path]) => path)).not.toContain(
        'dcl/vehicle/create',
      )
      expect(mockedPost.mock.calls.map(([path]) => path)).not.toContain(
        'dcl/vehicle/save',
      )
    },
  )

  it('requests only enabled other-unit references for external carriers', async () => {
    vi.useFakeTimers()
    try {
      useSessionStore().permissions = [
        '/dcl/vehicle/create',
        '/aux/dictionary-item/query',
        '/bob/operating-entity/query',
        '/bob/other-unit/query',
      ]
      mockedPost.mockResolvedValue({ data: { items: [] } })
      const vm = useDclVehicleViewModel()

      vm.openCreate()
      vm.editorModel.value.carrierType = 'EXTERNAL'
      vm.searchEditorReference(
        'carrierServiceRelationshipObjectId',
        '承运商',
        vm.editorModel.value,
      )
      await vi.advanceTimersByTimeAsync(300)

      expect(mockedPost).toHaveBeenCalledWith('bob/other-unit/query', {
        page: 1,
        pageSize: 20,
        filters: {
          status: ['APPROVED'],
          enabled: true,
          keyword: '承运商',
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
