import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  createAccountingMapping,
  getAccountingMappingAuditHistory,
  mappingApprovalAction,
  queryAccountingMappings,
  type AccountingMapping,
} from '@/pages/dcl/acc-mapping/api'
import { createDclAccMappingViewModel } from '@/pages/dcl/acc-mapping/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const mapping = {
  bookId: '01JACC00000000000000000001',
  vouEntity: 'sale-order',
  availableApprovalActions: [],
  approval: {
    approvalEntryId: '01JMAP00000000000000000001',
    revision: 3,
  },
} as AccountingMapping

describe('DCL accounting mapping API boundary', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('creates and approves mappings only through typed DCL routes', async () => {
    mockedPost.mockResolvedValue({ data: {} } as never)

    await createAccountingMapping({
      bookId: mapping.bookId,
      vouEntity: mapping.vouEntity,
      defaultResult: 'UN_POST',
      definition: { defaultTemplateId: null, rules: [], templates: [] },
    })
    await mappingApprovalAction('approve', mapping)

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/acc-mapping/create', {
      bookId: mapping.bookId,
      vouEntity: mapping.vouEntity,
      data: {
        defaultResult: 'UN_POST',
        definition: { defaultTemplateId: null, rules: [], templates: [] },
      },
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/acc-mapping/approve', {
      bookId: mapping.bookId,
      vouEntity: mapping.vouEntity,
      approvalEntryId: mapping.approval.approvalEntryId,
      approvalRevision: mapping.approval.revision,
    })
  })

  it('unsubmits mappings without a review reason field', async () => {
    mockedPost.mockResolvedValue({ data: {} } as never)

    await mappingApprovalAction('unsubmit', mapping)

    expect(mockedPost).toHaveBeenCalledWith('dcl/acc-mapping/unsubmit', {
      bookId: mapping.bookId,
      vouEntity: mapping.vouEntity,
      approvalEntryId: mapping.approval.approvalEntryId,
      approvalRevision: mapping.approval.revision,
    })
  })

  it('loads DCL audit history with bounded pagination', async () => {
    mockedPost.mockResolvedValue({ data: { items: [] } } as never)

    await getAccountingMappingAuditHistory(mapping.bookId, mapping.vouEntity)

    expect(mockedPost).toHaveBeenCalledWith('dcl/acc-mapping/audit-history', {
      bookId: mapping.bookId,
      vouEntity: mapping.vouEntity,
      page: 1,
      pageSize: 100,
    })
  })

  it('sends VOU and approval status filters only when the user applies them', async () => {
    mockedPost.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    } as never)

    await queryAccountingMappings({
      bookId: mapping.bookId,
      vouEntity: mapping.vouEntity,
      status: ['DRAFT', 'PENDING'],
      page: 1,
      pageSize: 20,
    })

    expect(mockedPost).toHaveBeenCalledWith('dcl/acc-mapping/query', {
      bookId: mapping.bookId,
      page: 1,
      pageSize: 20,
      filters: { vouEntity: mapping.vouEntity, status: ['DRAFT', 'PENDING'] },
      sort: [{ field: 'vouEntity', order: 'asc' }],
    })
  })

  it('hides approve and reject from the submitter', () => {
    const session = useSessionStore()
    session.user = {
      id: 'USER-1',
      username: 'submitter',
      displayName: '提交人',
      avatarUrl: null,
    }
    session.permissions = [
      '/acc/book/query',
      '/dcl/acc-mapping/query',
      '/dcl/acc-mapping/get',
      '/dcl/acc-mapping/approve',
      '/dcl/acc-mapping/reject',
      '/dcl/acc-mapping/unsubmit',
    ]
    const vm = createDclAccMappingViewModel()
    const pending = {
      ...mapping,
      availableApprovalActions: ['unsubmit'],
      approval: {
        ...mapping.approval,
        status: 'PENDING',
        submittedBy: 'USER-1',
      },
    } as AccountingMapping

    expect(vm.approvalActions(pending)).toEqual(['unsubmit'])
  })

  it('orchestrates DCL maintenance, history, and lifecycle actions', async () => {
    useSessionStore().permissions = [
      '/acc/book/query',
      '/acc/mapping/catalog',
      '/dcl/acc-mapping/query',
      '/dcl/acc-mapping/get',
      '/dcl/acc-mapping/create',
      '/dcl/acc-mapping/save',
      '/dcl/acc-mapping/submit',
      '/dcl/acc-mapping/unapprove',
      '/dcl/acc-mapping/create-next',
      '/dcl/acc-mapping/versions',
      '/dcl/acc-mapping/audit-history',
    ]
    const fullMapping = {
      ...mapping,
      availableApprovalActions: ['submit'],
      approval: {
        ...mapping.approval,
        versionNo: 1,
        status: 'DRAFT' as const,
        createdBy: 'USER-1',
        createdAt: '2026-08-28T00:00:00Z',
        updatedBy: 'USER-1',
        updatedAt: '2026-08-28T00:00:00Z',
        submittedBy: null,
        submittedAt: null,
        approvedBy: null,
        approvedAt: null,
      },
      data: {
        defaultResult: 'UN_POST' as const,
        definition: { defaultTemplateId: null, rules: [], templates: [] },
      },
    }
    mockedPost.mockImplementation(((path: string) => {
      if (path === 'acc/book/query') {
        return Promise.resolve({
          data: {
            items: [{ bookId: mapping.bookId, code: 'MAIN', name: '主账簿' }],
            total: 1,
          },
        })
      }
      if (path === 'dcl/acc-mapping/query') {
        return Promise.resolve({
          data: { items: [fullMapping], total: 1, page: 1, pageSize: 20 },
        })
      }
      if (path === 'dcl/acc-mapping/get')
        return Promise.resolve({ data: fullMapping })
      if (path === 'dcl/acc-mapping/versions') {
        return Promise.resolve({
          data: { items: [fullMapping], total: 1, page: 1, pageSize: 100 },
        })
      }
      if (path === 'dcl/acc-mapping/audit-history') {
        return Promise.resolve({
          data: { items: [], total: 0, page: 1, pageSize: 100 },
        })
      }
      return Promise.resolve({ data: {} })
    }) as typeof apiClient.postContract)

    const vm = createDclAccMappingViewModel()
    await vm.initialize()
    expect(vm.rows).toHaveLength(1)
    expect(vm.canCreate).toBe(true)
    expect(vm.canEdit).toBe(true)

    await vm.openCreate()
    vm.closeEditor()
    await vm.openEdit(vm.rows[0]!)
    vm.closeEditor()
    await vm.loadVersions(vm.rows[0]!)
    await vm.loadAudit(vm.rows[0]!)
    await vm.createNext(vm.rows[0]!)
    await vm.changeState(vm.rows[0]!, 'submit')
    vm.approvalReason = '制度调整'
    await vm.changeState(
      {
        ...fullMapping,
        availableApprovalActions: ['unapprove'],
        approval: { ...fullMapping.approval, status: 'APPROVED' },
      },
      'unapprove',
    )
    await vm.changePage(2)
    await vm.changeBook(mapping.bookId)
    vm.entityFilter = 'sale-order'
    await vm.resetFilters()

    expect(vm.versionsOpen).toBe(true)
    expect(vm.auditOpen).toBe(true)
    expect(mockedPost).toHaveBeenCalledWith(
      'dcl/acc-mapping/create-next',
      expect.any(Object),
    )
    expect(mockedPost).toHaveBeenCalledWith(
      'dcl/acc-mapping/submit',
      expect.any(Object),
    )
    expect(mockedPost).toHaveBeenCalledWith('dcl/acc-mapping/unapprove', {
      bookId: mapping.bookId,
      vouEntity: mapping.vouEntity,
      approvalEntryId: mapping.approval.approvalEntryId,
      approvalRevision: mapping.approval.revision,
      reason: '制度调整',
    })
  })
})
