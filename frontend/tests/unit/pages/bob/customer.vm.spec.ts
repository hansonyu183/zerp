import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { createCustomerForm } from '@/pages/bob/customer/form'
import { useCustomerViewModel } from '@/pages/bob/customer/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    postContract: vi.fn(),
    uploadCustomerAttachment: vi.fn(),
    fetchCustomerAttachment: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

function page(name: string) {
  return {
    data: {
      items: [
        {
          objectId: `${name}-id`,
          code: `CUS-${name}`,
          enabled: true,
          effective: null,
          candidate: {
            versionId: `${name}-v1`,
            revision: 1,
            status: 'DRAFT',
            name,
            customerTypeCode: 'DIT-0001',
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  }
}

describe('customer workspace view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().permissions = [
      '/bob/customer/query', '/bob/customer/get', '/bob/customer/create', '/bob/customer/save',
      '/bob/customer/submit', '/bob/customer/disable', '/bob/operating-entity/query',
      '/bob/employee/query', '/bob/other-party/query', '/aux/settlement-method/query',
      '/aux/payment-method/query', '/aux/dictionary-item/query',
    ]
    mockedApiClient.postContract.mockReset()
  })

  it('uses target customer filters and rejects a stale list response', async () => {
    let resolveFirst!: (value: ReturnType<typeof page>) => void
    mockedApiClient.postContract
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(page('new'))

    const vm = useCustomerViewModel()
    vm.keyword.value = '旧客户'
    const first = vm.query()
    vm.keyword.value = '新客户'
    vm.filters.value.operatingEntityId = 'ope-1'
    const second = vm.query()
    await second
    resolveFirst(page('old'))
    await first

    expect(mockedApiClient.postContract).toHaveBeenNthCalledWith(
      2,
      'bob/customer/query',
      {
        page: 1,
        pageSize: 20,
        filters: { keyword: '新客户', operatingEntityId: 'ope-1' },
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    expect(vm.rows.value).toMatchObject([{ code: 'CUS-new', name: 'new' }])
  })

  it('saves group-owned fields and the account candidate atomically', async () => {
    mockedApiClient.postContract.mockResolvedValue({ data: {} })
    const vm = useCustomerViewModel()
    const form = createCustomerForm()
    form.group.companyName = ' 测试集团 '
    form.account.name = ' 测试客户 '
    form.account.primarySalesAttribution.subject = {
      objectId: 'employee-1',
      versionId: 'employee-version-1',
      code: 'EMP-1',
      name: '业务员',
      entity: 'employee',
    }
    vm.mode.value = 'edit'
    vm.form.value = form
    vm.detail.value = {
      objectId: 'customer-1',
      code: 'CUS-1',
      objectRevision: 3,
      versionId: 'customer-version-1',
      revision: 2,
      group: {
        ...form.group,
        groupId: 'group-1',
        revision: 4,
        attachments: [],
      },
      versionStatus: 'DRAFT',
      accountAttachments: [],
      effectiveAccount: null,
      candidateAccount: null,
    }

    await expect(vm.save()).resolves.toBe(true)

    expect(mockedApiClient.postContract).toHaveBeenCalledTimes(2)
    expect(mockedApiClient.postContract).toHaveBeenNthCalledWith(
      1,
      'bob/customer/save',
      expect.objectContaining({
        objectId: 'customer-1',
        versionId: 'customer-version-1',
        revision: 2,
        groupRevision: 4,
        group: expect.objectContaining({ companyName: '测试集团' }),
      }),
    )
  })

  it('sends only the fields allowed by each lifecycle action contract', async () => {
    mockedApiClient.postContract.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 } })
    const vm = useCustomerViewModel()
    const row = {
      objectId: 'customer-1',
      code: 'CUS-1',
      name: '测试客户',
      enabled: true,
      status: 'EFFECTIVE',
      customerType: '',
      hasCandidate: false,
      objectRevision: 3,
      versionId: 'customer-version-1',
      revision: 2,
    }

    await expect(vm.runLifecycle(row, 'disable')).resolves.toBe(true)

    expect(mockedApiClient.postContract).toHaveBeenNthCalledWith(
      1,
      'bob/customer/disable',
      { objectId: 'customer-1', objectRevision: 3 },
    )
  })

  it('gates every lifecycle action by state, permission, and self-review rule', () => {
    const session = useSessionStore()
    session.user = { id: 'user-1', username: 'reviewer', displayName: '审核人' }
    session.permissions.push(
      '/bob/customer/unsubmit',
      '/bob/customer/approve',
      '/bob/customer/reject',
      '/bob/customer/unapprove',
      '/bob/customer/enable',
      '/bob/customer/delete',
    )
    const vm = useCustomerViewModel()
    const pending = {
      objectId: 'customer-1', code: 'CUS-1', name: '客户', enabled: true,
      status: 'PENDING', customerType: 'DIT-0001', hasCandidate: true,
      objectRevision: 2, versionId: 'version-2', revision: 3,
      submittedBy: 'user-1',
    }

    expect(vm.canLifecycleFor(pending, 'unsubmit')).toBe(true)
    expect(vm.canLifecycleFor(pending, 'approve')).toBe(false)
    expect(vm.canLifecycleFor(pending, 'reject')).toBe(false)
    pending.submittedBy = 'user-2'
    expect(vm.canLifecycleFor(pending, 'approve')).toBe(true)
    expect(vm.canLifecycleFor(pending, 'delete')).toBe(true)
    expect(vm.canLifecycleFor(pending, 'disable')).toBe(false)
  })

  it('blocks entry points when one permission in the operation closure is missing', async () => {
    useSessionStore().permissions = ['/bob/customer/create']
    const vm = useCustomerViewModel()

    vm.openCreate()

    expect(vm.canCreate.value).toBe(false)
    expect(vm.workspaceOpen.value).toBe(false)
    await expect(
      vm.runLifecycle(
        {
          objectId: 'customer-1', code: 'CUS-1', name: '客户', enabled: true,
          status: 'DRAFT', customerType: 'DIT-0001', hasCandidate: true,
          objectRevision: 1, versionId: 'version-1', revision: 1,
        },
        'submit',
      ),
    ).resolves.toBe(false)
    expect(mockedApiClient.postContract).not.toHaveBeenCalled()
  })

  it('removes an account attachment with draft revision and refreshes both scopes', async () => {
    useSessionStore().permissions.push('/bob/customer/attachment-remove')
    mockedApiClient.postContract
      .mockResolvedValueOnce({ data: { revision: 3 } })
      .mockResolvedValueOnce({
        data: {
          objectRevision: 1,
          group: { groupId: 'group-1', revision: 5, attachments: [], data: {} },
          effective: null,
          candidate: {
            version: { versionId: 'version-1', revision: 3, status: 'DRAFT' },
            attachments: [],
          },
        },
      })
    const vm = useCustomerViewModel()
    const form = createCustomerForm()
    vm.detail.value = {
      objectId: 'customer-1', code: 'CUS-1', objectRevision: 1,
      versionId: 'version-1', revision: 2, versionStatus: 'DRAFT',
      group: { ...form.group, groupId: 'group-1', revision: 4, attachments: [] },
      accountAttachments: [], effectiveAccount: null, candidateAccount: null,
    }
    const attachment = {
      fileId: 'file-1', fileName: 'contract.pdf', contentType: 'application/pdf' as const,
      size: 10, sha256: 'a'.repeat(64), status: 'READY' as const,
      categoryObjectId: 'category-1', categoryVersionId: 'category-v1',
      categoryCode: 'DIT-0007', categoryName: '合同',
      createdAt: '2026-08-19T00:00:00Z', createdBy: 'actor-1',
    }

    await vm.removeAttachment('ACCOUNT', attachment)

    expect(mockedApiClient.postContract).toHaveBeenNthCalledWith(
      1,
      'bob/customer/attachment-remove',
      { scope: 'ACCOUNT', ownerId: 'version-1', revision: 2, fileId: 'file-1' },
    )
    expect(vm.detail.value?.revision).toBe(3)
    expect(vm.detail.value?.group.revision).toBe(5)
  })
})
import { createPinia, setActivePinia } from 'pinia'
