import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
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
})
