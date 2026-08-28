import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclSupplierViewModel } from '@/pages/dcl/supplier/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: 'SUP-V1',
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

describe('DCL supplier view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('creates a declaration with exact settlement and default purchaser references', async () => {
    useSessionStore().permissions = [
      '/dcl/supplier/create',
      '/bob/party/query',
      '/bob/operating-entity/query',
      '/aux/settlement-method/query',
      '/bob/employee/query',
    ]
    mockedPost.mockResolvedValue({ data: { items: [] } })
    const vm = useDclSupplierViewModel()
    vm.openCreate()
    await expect(
      vm.save({
        ...vm.editorModel.value,
        partyMode: 'EXISTING',
        partyId: 'PARTY-1',
        operatingEntityId: 'OPE-1',
        settlementMethodId: 'SET-1',
        defaultPurchaserEmployeeId: 'EMP-1',
        contactName: '李四',
      }),
    ).resolves.toBe(true)
    expect(mockedPost).toHaveBeenCalledWith('dcl/supplier/create', {
      partyId: 'PARTY-1',
      operatingEntityId: 'OPE-1',
      data: {
        shortName: null,
        taxNumber: null,
        contactName: '李四',
        contactPhone: null,
        email: null,
        address: null,
        remark: null,
        settlementMethodId: 'SET-1',
        defaultPurchaserEmployeeId: 'EMP-1',
      },
    })
  })

  it('keeps new Party tax identity separate from the supplier declaration tax number', async () => {
    useSessionStore().permissions = [
      '/dcl/supplier/create',
      '/bob/party/query',
      '/bob/operating-entity/query',
      '/aux/settlement-method/query',
      '/bob/employee/query',
    ]
    mockedPost.mockResolvedValue({ data: { items: [] } })
    const vm = useDclSupplierViewModel()
    vm.openCreate()
    await expect(
      vm.save({
        ...vm.editorModel.value,
        partyMode: 'NEW',
        legalName: '新建主体',
        partyTaxNumber: 'PARTY-TAX-1',
        taxNumber: 'SUPPLIER-TAX-1',
        operatingEntityId: 'OPE-1',
      }),
    ).resolves.toBe(true)
    expect(mockedPost).toHaveBeenCalledWith('dcl/supplier/create', {
      newParty: {
        kind: 'ORGANIZATION',
        legalName: '新建主体',
        taxNumber: 'PARTY-TAX-1',
        strongIdentifiers: [],
      },
      operatingEntityId: 'OPE-1',
      data: expect.objectContaining({ taxNumber: 'SUPPLIER-TAX-1' }),
    })
  })

  it('uses DCL approval actions, never the removed BOB lifecycle', async () => {
    useSessionStore().permissions = [
      '/dcl/supplier/query',
      '/dcl/supplier/submit',
    ]
    const row = {
      objectId: 'SUP-1',
      entity: 'supplier' as const,
      code: 'SUP-0001',
      partyId: 'PARTY-1',
      partyKind: 'ORGANIZATION' as const,
      partyDisplayName: '供应商',
      operatingEntityId: 'OPE-1',
      operatingEntityCode: 'OPE-0001',
      operatingEntityName: '主体',
      objectRevision: 1,
      enabled: true,
      latestApproved: null,
      openVersion: {
        approval,
        enabled: true,
        data: { settlementMethod: null, defaultPurchaser: null },
      },
      updatedAt: '2026-08-28T00:00:00Z',
    }
    mockedPost
      .mockResolvedValueOnce({
        data: { items: [row], total: 1, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclSupplierViewModel()
    await vm.query()
    await expect(vm.submitObject(row)).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/supplier/submit', {
      objectId: 'SUP-1',
      approvalEntryId: 'SUP-V1',
      approvalRevision: 2,
    })
    expect(mockedPost.mock.calls.map(([path]) => String(path))).not.toContain(
      'bob/supplier/submit',
    )
  })
})
