import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useSessionStore } from '@/stores/session'
import {
  createDclCustomer,
  loadDclCustomerAudit,
  loadDclCustomerVersions,
  runDclCustomerAction,
} from '@/pages/dcl/customer/data'
import {
  createDclCustomerAccount,
  dclCustomerAccountPayload,
  loadDclCustomerAccountAudit,
  loadDclCustomerAccountVersions,
  runDclCustomerAccountAction,
} from '@/pages/dcl/customer-account/data'
import { createCustomerAccountForm } from '@/pages/dcl/customer-account/form'
import {
  initiateCustomerAttachment,
  removeCustomerAttachment,
} from '@/pages/dcl/customer-account/attachments'
import {
  useDclCustomerViewModel,
  customerActiveVersion,
} from '@/pages/dcl/customer/vm'
import {
  useDclCustomerAccountViewModel,
  customerAccountActiveVersion,
} from '@/pages/dcl/customer-account/vm'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

describe('DCL customer declarations', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockedPost.mockResolvedValue({ data: {} })
  })

  it('creates Party, relationship, and default account through DCL only', async () => {
    const account = createCustomerAccountForm()
    account.name = '华南结算户'
    account.primarySalesAttribution.subjectObjectId = 'EMP-1'

    await createDclCustomer({
      partyMode: 'NEW',
      partyId: '',
      partyKind: 'ORGANIZATION',
      legalName: '华南客户有限公司',
      displayName: '华南客户',
      taxNumber: '91440000TEST',
      identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE',
      identifierValue: '91440000TEST',
      operatingEntityId: 'OPE-1',
      defaultAccount: account,
    })

    expect(mockedPost).toHaveBeenCalledWith('dcl/customer/create', {
      newParty: {
        kind: 'ORGANIZATION',
        legalName: '华南客户有限公司',
        displayName: '华南客户',
        taxNumber: '91440000TEST',
        strongIdentifiers: [
          { type: 'UNIFIED_SOCIAL_CREDIT_CODE', value: '91440000TEST' },
        ],
      },
      operatingEntityId: 'OPE-1',
      defaultAccount: expect.objectContaining({
        name: '华南结算户',
        primarySalesAttribution: {
          type: 'INTERNAL_EMPLOYEE',
          subjectObjectId: 'EMP-1',
        },
      }),
    })
    expect(mockedPost.mock.calls.map(([path]) => String(path))).not.toContain(
      'bob/customer/create',
    )
  })

  it('creates an additional account without accepting an operating entity override', async () => {
    const account = createCustomerAccountForm()
    account.name = '第二结算户'
    account.primarySalesAttribution.subjectObjectId = 'SAL-1'
    account.primarySalesAttribution.type = 'CHANNEL_PARTNER'

    await createDclCustomerAccount('CUR-1', account)

    const payload = dclCustomerAccountPayload(account)
    expect(payload).not.toHaveProperty('operatingEntityId')
    expect(mockedPost).toHaveBeenCalledWith('dcl/customer-account/create', {
      customerRelationshipId: 'CUR-1',
      data: payload,
    })
  })

  it('routes both independent lifecycles through exact DCL paths', async () => {
    const request = {
      objectId: 'OBJECT-1',
      approvalEntryId: 'ENTRY-1',
      approvalRevision: 3,
    }
    await runDclCustomerAction('submit', request, '')
    await runDclCustomerAccountAction('reject', request, '资料不完整')

    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'dcl/customer/submit',
      request,
    )
    expect(mockedPost).toHaveBeenNthCalledWith(
      2,
      'dcl/customer-account/reject',
      { ...request, reason: '资料不完整' },
    )
  })

  it('owns relationship and account attachments by approval entry', async () => {
    await initiateCustomerAttachment({
      scope: 'CUSTOMER_ACCOUNT',
      ownerApprovalEntryId: 'ENTRY-1',
      approvalRevision: 4,
      categoryObjectId: 'DOC-1',
      fileName: 'credit.pdf',
      contentType: 'application/pdf',
      size: 12,
      sha256: 'a'.repeat(64),
    })
    await removeCustomerAttachment({
      scope: 'CUSTOMER',
      ownerApprovalEntryId: 'ENTRY-2',
      approvalRevision: 2,
      fileId: 'FILE-1',
    })

    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'dcl/customer/attachment-initiate',
      expect.objectContaining({
        scope: 'CUSTOMER_ACCOUNT',
        ownerApprovalEntryId: 'ENTRY-1',
      }),
    )
    expect(mockedPost).toHaveBeenNthCalledWith(
      2,
      'dcl/customer/attachment-remove',
      expect.objectContaining({
        scope: 'CUSTOMER',
        ownerApprovalEntryId: 'ENTRY-2',
      }),
    )
  })

  it('loads independent relationship and account histories from DCL', async () => {
    mockedPost.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    await loadDclCustomerVersions('CUR-1')
    await loadDclCustomerAudit('CUR-1')
    await loadDclCustomerAccountVersions('CAC-1')
    await loadDclCustomerAccountAudit('CAC-1')

    expect(mockedPost.mock.calls.map(([path]) => String(path))).toEqual([
      'dcl/customer/versions',
      'dcl/customer/audit-history',
      'dcl/customer-account/versions',
      'dcl/customer-account/audit-history',
    ])
  })

  it('drives customer relationship list and lifecycle interactions', async () => {
    const approval = {
      approvalEntryId: 'ENTRY-1',
      revision: 1,
      status: 'DRAFT',
      versionNo: 1,
      submittedBy: null,
    }
    const row = {
      objectId: 'CUR-1',
      enabled: true,
      availableApprovalActions: ['submit'],
      openVersion: { approval },
      latestApproved: null,
    } as never
    mockedPost.mockImplementation(async (path) => {
      const value = String(path)
      if (value === 'dcl/customer/query')
        return {
          data: { items: [row], total: 1, page: 2, pageSize: 20 },
        } as never
      if (value === 'dcl/customer/get')
        return { data: { objectId: 'CUR-1', approval } } as never
      if (value.endsWith('/versions') || value.endsWith('/audit-history'))
        return { data: { items: [], total: 0, page: 1, pageSize: 20 } } as never
      return { data: {} } as never
    })

    const vm = useDclCustomerViewModel()
    await vm.query()
    await vm.search()
    await vm.changePage(2)
    vm.openCreate()
    expect(await vm.create()).toBe(false)
    await vm.openById('CUR-1')
    expect(await vm.runAction(row, 'submit')).toBe(true)
    await vm.toggleEnabled(row)
    await vm.remove(row)
    await vm.openVersions(row)
    await vm.openAudit(row)

    expect(customerActiveVersion(row).approval.approvalEntryId).toBe('ENTRY-1')
    expect(vm.rows.value).toHaveLength(1)
    expect(vm.drawerOpen.value).toBe(true)
    expect(vm.versionsOpen.value).toBe(true)
    expect(vm.auditOpen.value).toBe(true)
  })

  it('refreshes the customer relationship after a lifecycle failure without replaying it', async () => {
    const approval = {
      approvalEntryId: 'ENTRY-STALE',
      revision: 1,
      status: 'DRAFT',
      versionNo: 1,
      submittedBy: null,
    }
    const row = {
      objectId: 'CUR-STALE',
      enabled: true,
      availableApprovalActions: ['submit'],
      openVersion: { approval },
      latestApproved: null,
    } as never
    mockedPost.mockImplementation(async (path) => {
      if (path === 'dcl/customer/submit') throw new Error('版本已变化')
      if (path === 'dcl/customer/get')
        return {
          data: { objectId: 'CUR-STALE', enabled: true, approval },
        } as never
      if (path === 'dcl/customer/query')
        return {
          data: { items: [], total: 0, page: 1, pageSize: 20 },
        } as never
      return { data: {} } as never
    })

    const vm = useDclCustomerViewModel()
    await vm.openById('CUR-STALE', 'ENTRY-STALE')
    expect(await vm.runAction(row, 'submit')).toBe(false)

    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/customer/submit'),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/customer/query'),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/customer/get'),
    ).toHaveLength(2)
    expect(vm.errorMessage.value).toBe('版本已变化')
  })

  it('refreshes the customer relationship after enabled-state and delete failures without replay', async () => {
    const approval = {
      approvalEntryId: 'ENTRY-MUTATION',
      revision: 4,
      status: 'DRAFT',
      versionNo: 1,
      submittedBy: null,
    }
    const row = {
      objectId: 'CUR-MUTATION',
      enabled: true,
      availableApprovalActions: [],
      openVersion: { approval },
      latestApproved: null,
    } as never
    const view = {
      objectId: 'CUR-MUTATION',
      enabled: true,
      approval,
    }
    const vm = useDclCustomerViewModel()
    mockedPost.mockResolvedValueOnce({ data: view } as never)
    await vm.openById('CUR-MUTATION', 'ENTRY-MUTATION')

    vi.clearAllMocks()
    mockedPost.mockImplementation(async (path) => {
      if (path === 'dcl/customer/save')
        throw new Error('enabled stale revision')
      if (path === 'dcl/customer/query')
        return {
          data: { items: [], total: 0, page: 1, pageSize: 20 },
        } as never
      if (path === 'dcl/customer/get') return { data: view } as never
      return { data: {} } as never
    })
    await vm.toggleEnabled(row)
    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/customer/save'),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/customer/query'),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/customer/get'),
    ).toHaveLength(1)

    vi.clearAllMocks()
    mockedPost.mockImplementation(async (path) => {
      if (path === 'dcl/customer/delete') throw new Error('delete blocked')
      if (path === 'dcl/customer/query')
        return {
          data: { items: [], total: 0, page: 1, pageSize: 20 },
        } as never
      if (path === 'dcl/customer/get') return { data: view } as never
      return { data: {} } as never
    })
    await vm.remove(row)
    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/customer/delete'),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/customer/query'),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/customer/get'),
    ).toHaveLength(1)
  })

  it('drives customer account list and lifecycle interactions', async () => {
    const session = useSessionStore()
    session.permissions = [
      '/dcl/customer-account/create',
      '/bob/customer/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]
    const approval = {
      approvalEntryId: 'ENTRY-2',
      revision: 2,
      status: 'DRAFT',
      versionNo: 1,
      submittedBy: null,
    }
    const row = {
      objectId: 'CAC-1',
      enabled: true,
      availableApprovalActions: ['submit'],
      openVersion: { approval },
      latestApproved: null,
    } as never
    const form = createCustomerAccountForm()
    const view = {
      objectId: 'CAC-1',
      enabled: true,
      approval,
      data: {
        ...dclCustomerAccountPayload(form),
        customerType: {
          sourceObjectId: form.customerTypeId,
          code: 'TYPE-001',
          name: '普通客户',
        },
        operatingEntityId: 'OPE-1',
        operatingEntity: null,
        settlementMethod: null,
        paymentMethod: null,
        primarySalesAttribution: {
          ...form.primarySalesAttribution,
          subjectApprovalEntryId: 'EMP-ENTRY-1',
          subjectCode: 'EMP-001',
          subjectName: '张三',
        },
      },
    }
    mockedPost.mockImplementation(async (path) => {
      const value = String(path)
      if (value === 'dcl/customer-account/query')
        return {
          data: { items: [row], total: 1, page: 3, pageSize: 20 },
        } as never
      if (value === 'dcl/customer-account/get') return { data: view } as never
      if (value.endsWith('/versions') || value.endsWith('/audit-history'))
        return { data: { items: [], total: 0, page: 1, pageSize: 20 } } as never
      return { data: {} } as never
    })

    const vm = useDclCustomerAccountViewModel()
    await vm.query()
    await vm.search()
    await vm.changePage(3)
    vm.openCreate()
    expect(vm.drawerOpen.value).toBe(true)
    expect(await vm.save()).toBe(false)
    await vm.openById('CAC-1', 'edit')
    expect(await vm.runAction(row, 'submit')).toBe(true)
    await vm.remove(row)
    await vm.toggleEnabled(row)
    await vm.openVersions(row)
    await vm.openAudit(row)

    expect(customerAccountActiveVersion(row).approval.approvalEntryId).toBe(
      'ENTRY-2',
    )
    expect(vm.rows.value).toHaveLength(1)
    expect(vm.editorMode.value).toBe('edit')
    expect(vm.versionsOpen.value).toBe(true)
    expect(vm.auditOpen.value).toBe(true)
  })

  it('refreshes customer account rows after delete and enabled-state failures without replay', async () => {
    const approval = {
      approvalEntryId: 'ENTRY-FAIL',
      revision: 2,
      status: 'DRAFT',
      versionNo: 1,
      submittedBy: null,
    }
    const row = {
      objectId: 'CAC-FAIL',
      enabled: true,
      availableApprovalActions: [],
      openVersion: { approval },
      latestApproved: null,
    } as never
    const form = createCustomerAccountForm()
    const view = {
      objectId: 'CAC-FAIL',
      enabled: true,
      approval,
      data: dclCustomerAccountPayload(form),
    }
    const vm = useDclCustomerAccountViewModel()

    mockedPost.mockImplementation(async (path) => {
      if (path === 'dcl/customer-account/delete')
        throw new Error('delete stale revision')
      if (path === 'dcl/customer-account/query')
        return {
          data: { items: [], total: 0, page: 1, pageSize: 20 },
        } as never
      return { data: {} } as never
    })
    await vm.remove(row)
    expect(
      mockedPost.mock.calls.filter(
        ([path]) => path === 'dcl/customer-account/delete',
      ),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(
        ([path]) => path === 'dcl/customer-account/query',
      ),
    ).toHaveLength(1)

    vi.clearAllMocks()
    mockedPost.mockImplementation(async (path) => {
      if (path === 'dcl/customer-account/get') return { data: view } as never
      if (path === 'dcl/customer-account/save')
        throw new Error('enabled stale revision')
      if (path === 'dcl/customer-account/query')
        return {
          data: { items: [], total: 0, page: 1, pageSize: 20 },
        } as never
      return { data: {} } as never
    })
    await vm.toggleEnabled(row)
    expect(
      mockedPost.mock.calls.filter(
        ([path]) => path === 'dcl/customer-account/save',
      ),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(
        ([path]) => path === 'dcl/customer-account/query',
      ),
    ).toHaveLength(1)
  })

  it('preloads controlled customer references and gates creation on every query permission', async () => {
    const session = useSessionStore()
    session.permissions = ['/dcl/customer/create']
    const vm = useDclCustomerViewModel()

    expect(vm.canCreate.value).toBe(false)
    vm.openCreate()
    expect(vm.createOpen.value).toBe(false)

    session.permissions = [
      '/dcl/customer/create',
      '/bob/party/query',
      '/bob/operating-entity/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]
    mockedPost.mockImplementation(async (path, body) => {
      if (path === 'bob/party/query')
        return {
          data: { items: [{ partyId: 'PTY-1', displayName: '华南主体' }] },
        } as never
      if (path === 'bob/operating-entity/query')
        return {
          data: {
            items: [
              {
                objectId: 'OPE-1',
                code: 'OPE-001',
                data: { name: '华南经营主体' },
              },
            ],
          },
        } as never
      if (path === 'aux/reference/query') {
        const entity = (body as { entity: string }).entity
        return {
          data: [
            {
              objectId: `${entity}-1`,
              code: 'REF-001',
              name: `${entity} 名称`,
            },
          ],
        } as never
      }
      if (path === 'bob/reference/query')
        return {
          data: [{ objectId: 'EMP-1', code: 'EMP-001', name: '张三' }],
        } as never
      return { data: {} } as never
    })

    vm.openCreate()
    await vi.waitFor(() =>
      expect(vm.referenceOptions.value.operatingEntityId).toEqual([
        { value: 'OPE-1', title: 'OPE-001 · 华南经营主体' },
      ]),
    )

    expect(vm.referenceOptions.value.partyId).toEqual([
      { value: 'PTY-1', title: 'PTY-1 · 华南主体' },
    ])
    expect(
      vm.referenceOptions.value.primarySalesAttributionSubjectObjectId,
    ).toEqual([{ value: 'EMP-1', title: 'EMP-001 · 张三' }])
  })

  it('keeps the latest customer account reference result and the selected relationship', async () => {
    vi.useFakeTimers()
    const session = useSessionStore()
    session.permissions = [
      '/dcl/customer-account/create',
      '/bob/customer/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]
    let resolveFirst!: (value: never) => void
    let resolveSecond!: (value: never) => void
    let customerQueries = 0
    mockedPost.mockImplementation((path) => {
      if (path === 'bob/customer/query') {
        customerQueries += 1
        return new Promise((resolve) => {
          if (customerQueries === 1)
            resolveFirst = resolve as typeof resolveFirst
          else resolveSecond = resolve as typeof resolveSecond
        }) as never
      }
      if (path === 'aux/reference/query')
        return Promise.resolve({ data: [] }) as never
      if (path === 'bob/reference/query')
        return Promise.resolve({ data: [] }) as never
      return Promise.resolve({ data: {} }) as never
    })
    const vm = useDclCustomerAccountViewModel()
    vm.customerRelationshipId.value = 'CUR-SELECTED'
    vm.searchCustomerRelationships('旧关键词')
    await vi.advanceTimersByTimeAsync(250)
    vm.searchCustomerRelationships('新关键词')
    await vi.advanceTimersByTimeAsync(250)

    expect(customerQueries).toBe(2)

    resolveSecond({
      data: {
        items: [
          {
            objectId: 'CUR-NEW',
            code: 'CUR-002',
            partyDisplayName: '新客户',
          },
        ],
      },
    } as never)
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    resolveFirst({
      data: {
        items: [
          {
            objectId: 'CUR-OLD',
            code: 'CUR-001',
            partyDisplayName: '旧客户',
          },
        ],
      },
    } as never)
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(vm.customerRelationshipOptions.value).toEqual([
      { value: 'CUR-NEW', title: 'CUR-002 · 新客户' },
      { value: 'CUR-SELECTED', title: 'CUR-SELECTED' },
    ])
    vi.useRealTimers()
  })
})
