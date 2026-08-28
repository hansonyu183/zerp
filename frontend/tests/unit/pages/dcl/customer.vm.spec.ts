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

  it('drives customer account list and lifecycle interactions', async () => {
    const session = useSessionStore()
    session.permissions = ['/dcl/customer-account/create']
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
      openVersion: { approval },
      latestApproved: null,
    } as never
    const form = createCustomerAccountForm()
    const view = {
      objectId: 'CAC-1',
      enabled: true,
      approval,
      data: dclCustomerAccountPayload(form),
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
    vm.customerRelationshipId.value = 'CUR-1'
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
})
