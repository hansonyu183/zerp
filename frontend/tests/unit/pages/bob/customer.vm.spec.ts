import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { createCustomerForm } from '@/pages/bob/customer/form'
import { useCustomerViewModel } from '@/pages/bob/customer/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn(), uploadCustomerAttachment: vi.fn(), fetchCustomerAttachment: vi.fn() } }))
const mockedApiClient = vi.mocked(apiClient)

function listPage(name: string) {
  return { data: { items: [{ objectId: `${name}-id`, code: `CAC-${name}`, enabled: true, effective: null, candidate: { versionId: `${name}-v1`, revision: 1, status: 'DRAFT', name, customerTypeCode: 'DIT-0001' }, updatedAt: '2026-01-01T00:00:00Z' }], total: 1, page: 1, pageSize: 20 } }
}

describe('customer relationship view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().permissions = [
      '/bob/customer/query', '/bob/customer/get', '/bob/customer/create', '/bob/customer/save',
      '/bob/customer-account/create', '/bob/customer-account/delete', '/bob/customer-account/submit',
      '/bob/party/create', '/bob/party/get', '/bob/party/query', '/bob/operating-entity/query',
      '/bob/employee/query', '/bob/sales-partner/query', '/aux/settlement-method/query',
      '/aux/payment-method/query', '/aux/dictionary-item/query',
    ]
    mockedApiClient.postContract.mockReset()
    mockedApiClient.postContract.mockReset()
  })

  it('keeps query pagination fixed at 20 and rejects stale account results', async () => {
    let resolveFirst!: (value: ReturnType<typeof listPage>) => void
    mockedApiClient.postContract.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve })).mockResolvedValueOnce(listPage('new'))
    const vm = useCustomerViewModel()
    vm.keyword.value = '旧客户'
    const first = vm.query()
    vm.keyword.value = '新客户'
    const second = vm.query()
    await second
    resolveFirst(listPage('old'))
    await first
    expect(mockedApiClient.postContract).toHaveBeenNthCalledWith(2, 'bob/customer/query', {
      page: 1, pageSize: 20, filters: { keyword: '新客户' }, sort: [{ field: 'code', order: 'asc' }],
    })
    expect(vm.rows.value).toMatchObject([{ code: 'CAC-new', name: 'new' }])
  })

  it('creates an account relationship with an existing Party', async () => {
    mockedApiClient.postContract.mockResolvedValue({ data: {} })
    const vm = useCustomerViewModel()
    const form = createCustomerForm()
    form.party.mode = 'EXISTING'
    form.party.partyId = 'party-1'
    form.account.name = '客户结算户'
    form.account.operatingEntity = { objectId: 'ope-1', versionId: '', code: 'OPE-1', name: '经营主体', entity: 'operating-entity' }
    form.account.primarySalesAttribution.subject = { objectId: 'employee-1', versionId: '', code: 'EMP-1', name: '业务员', entity: 'employee' }
    vm.form.value = form
    vm.mode.value = 'create'
    await expect(vm.save()).resolves.toBe(true)
    expect(mockedApiClient.postContract).toHaveBeenCalledWith('bob/customer/create', expect.objectContaining({ partyId: 'party-1', data: expect.objectContaining({ operatingEntityId: 'ope-1' }) }))
  })

  it('adds another account below the selected relationship', async () => {
    mockedApiClient.postContract.mockResolvedValue({ data: {} })
    const vm = useCustomerViewModel()
    vm.detail.value = { objectId: 'relationship-1', code: 'CUS-1', objectRevision: 1, enabled: true, partyId: 'party-1', partyKind: 'ORGANIZATION', partyDisplayName: '华东', operatingEntityId: 'ope-1', operatingEntityCode: 'OPE-1', operatingEntityName: '华东', accounts: [], attachments: [] }
    vm.openAddAccount()
    vm.form.value.account.name = '第二结算户'
    vm.form.value.account.operatingEntity = { objectId: 'ope-1', versionId: '', code: 'OPE-1', name: '华东', entity: 'operating-entity' }
    vm.form.value.account.primarySalesAttribution.subject = { objectId: 'employee-1', versionId: '', code: 'EMP-1', name: '张三', entity: 'employee' }
    await expect(vm.save()).resolves.toBe(true)
    expect(mockedApiClient.postContract).toHaveBeenCalledWith('bob/customer/account-add', expect.objectContaining({ customerRelationshipId: 'relationship-1' }))
  })
})
