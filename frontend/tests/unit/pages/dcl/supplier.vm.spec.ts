import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclSupplierViewModel } from '@/pages/dcl/supplier/vm'
import { useSessionStore } from '@/stores/session'
vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const post = vi.mocked(apiClient.postContract)
describe('DCL supplier view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  it('creates a supplier with its own identity and operating-entity scope', async () => {
    useSessionStore().permissions = [
      '/dcl/supplier/create',
      '/bob/operating-entity/query',
      '/aux/settlement-method/query',
      '/bob/employee/query',
    ]
    post.mockResolvedValue({ data: { items: [] } } as never)
    const vm = useDclSupplierViewModel()
    vm.openCreate()
    await expect(
      vm.save({
        ...vm.editorModel.value,
        legalName: '供应商甲',
        displayName: '供应商甲',
        legalIdentifier: '91350211M000100Y46',
        operatingEntityIds: ['OPE-1', 'OPE-2'],
        defaultOperatingEntityId: 'OPE-1',
      }),
    ).resolves.toBe(true)
    expect(post).toHaveBeenCalledWith('dcl/supplier/create', {
      data: expect.objectContaining({
        legalName: '供应商甲',
        legalIdentifier: '91350211M000100Y46',
        operatingEntityIds: ['OPE-1', 'OPE-2'],
        defaultOperatingEntityId: 'OPE-1',
      }),
    })
    expect(post.mock.calls.map(([path]) => path)).not.toContain(
      'bob/party/query',
    )
  })
})

describe('DCL supplier legal identifier', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const view = {
    objectId: 'SUP-1',
    entity: 'supplier',
    code: 'SUP-001',
    updatedAt: '2026-09-01T00:00:00Z',
    availableApprovalActions: [],
    approval: {
      approvalEntryId: 'APR-SUP-1',
      revision: 3,
      status: 'APPROVED',
      versionNo: 1,
    },
    data: {
      kind: 'ORGANIZATION',
      legalName: '供应商甲',
      legalIdentifier: '91350211M000100Y46',
      enabled: true,
      operatingEntityIds: ['OPE-1'],
      defaultOperatingEntityId: 'OPE-1',
      operatingEntities: [
        { sourceObjectId: 'OPE-1', code: 'OPE-001', name: '经营主体甲' },
      ],
      settlementMethod: null,
      defaultPurchaser: null,
    },
  } as never
  const row = {
    objectId: 'SUP-1',
    code: 'SUP-001',
    availableApprovalActions: [],
    latestApproved: { approval: view.approval, data: view.data },
    openVersion: null,
  } as never

  function mockRequests() {
    post.mockImplementation(
      async (path) =>
        ({
          data:
            path === 'dcl/supplier/get'
              ? view
              : { items: [], total: 0, page: 1, pageSize: 20 },
        }) as never,
    )
  }

  it('round-trips the legal identifier when editing and saving', async () => {
    useSessionStore().permissions = [
      '/dcl/supplier/get',
      '/dcl/supplier/save',
      '/bob/operating-entity/query',
      '/aux/settlement-method/query',
      '/bob/employee/query',
    ]
    mockRequests()
    const vm = useDclSupplierViewModel()

    await vm.openEdit(row)

    expect(vm.editorModel.value.legalIdentifier).toBe(view.data.legalIdentifier)
    await expect(vm.save(vm.editorModel.value)).resolves.toBe(true)
    expect(post).toHaveBeenCalledWith(
      'dcl/supplier/save',
      expect.objectContaining({
        data: expect.objectContaining({
          legalIdentifier: view.data.legalIdentifier,
        }),
      }),
    )
  })

  it('round-trips the legal identifier when disabling', async () => {
    useSessionStore().permissions = ['/dcl/supplier/get', '/dcl/supplier/save']
    mockRequests()
    const vm = useDclSupplierViewModel()

    await expect(vm.changeEnabled(row)).resolves.toBe(true)

    expect(post).toHaveBeenCalledWith(
      'dcl/supplier/save',
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: false,
          legalIdentifier: view.data.legalIdentifier,
        }),
      }),
    )
  })
})
