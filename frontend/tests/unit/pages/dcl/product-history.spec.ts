import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { dclProductHistoryPort } from '@/pages/dcl/product/data'
import { useDclDeclarationHistory } from '@/pages/dcl/shared/declaration'
import type { BobListItem } from '@/pages/bob/shared/types'

vi.mock('@/api/client', () => ({
  apiClient: {
    postContract: vi.fn(),
  },
}))

const mockedPost = vi.mocked(apiClient.postContract)

const row: BobListItem = {
  objectId: 'OBJECT-1',
  entity: 'product',
  code: 'PRODUCT-1',
  enabled: true,
  latestApproved: null,
  openVersion: {
    approval: {
      approvalEntryId: 'VERSION-1',
      versionNo: 1,
      status: 'DRAFT',
      revision: 1,
      createdBy: 'USER-1',
      createdAt: '2026-07-26T00:00:00Z',
      updatedBy: 'USER-1',
      updatedAt: '2026-07-26T00:00:00Z',
      submittedBy: null,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
    },
    summary: { name: '产品' },
  },
  updatedAt: '2026-07-26T00:00:00Z',
}

describe('DCL product history state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads version and audit pages with independent pagination', async () => {
    mockedPost
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              approval: {
                approvalEntryId: 'VERSION-1',
                versionNo: 1,
                status: 'DRAFT',
                revision: 1,
                createdBy: 'USER-1',
                createdAt: '2026-07-26T00:00:00Z',
                updatedBy: 'USER-1',
                updatedAt: '2026-07-26T00:00:00Z',
                submittedBy: null,
                submittedAt: null,
                approvedBy: null,
                approvedAt: null,
              },
              data: { name: '产品' },
            },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [],
          total: 2,
          page: 2,
          pageSize: 20,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'EVENT-1',
              approvalEntryId: 'VERSION-1',
              action: 'CREATED',
              fromStatus: null,
              toStatus: 'DRAFT',
              fromRevision: null,
              toRevision: 1,
              actorId: 'USER-1',
              createdAt: '2026-07-26T00:00:00Z',
              reason: null,
              requestId: 'REQUEST-1',
            },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [],
          total: 2,
          page: 2,
          pageSize: 20,
        },
      })
    const errorMessage = ref<string | null>(null)
    const history = useDclDeclarationHistory(
      errorMessage,
      () => true,
      () => true,
      dclProductHistoryPort,
    )

    await history.openVersions(row)
    expect(history.versionsOpen.value).toBe(true)
    expect(history.versions.value).toHaveLength(1)
    expect(history.versionsTotal.value).toBe(2)
    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/product/versions', {
      objectId: row.objectId,
      page: 1,
      pageSize: 20,
    })
    await history.changeVersionsPage(1)
    await history.changeVersionsPage(0)
    expect(mockedPost).toHaveBeenCalledTimes(1)
    await history.changeVersionsPage(2)
    expect(history.versionsPage.value).toBe(2)

    await history.openAudit(row)
    expect(history.auditOpen.value).toBe(true)
    expect(history.auditEvents.value).toHaveLength(1)
    expect(mockedPost).toHaveBeenNthCalledWith(3, 'dcl/product/audit-history', {
      objectId: row.objectId,
      page: 1,
      pageSize: 20,
    })
    await history.changeAuditPage(1)
    await history.changeAuditPage(0)
    expect(mockedPost).toHaveBeenCalledTimes(3)
    await history.changeAuditPage(2)
    expect(history.auditPage.value).toBe(2)
    expect(errorMessage.value).toBeNull()
  })

  it('honors permissions and reports request failures', async () => {
    const errorMessage = ref<string | null>(null)
    const blocked = useDclDeclarationHistory(
      errorMessage,
      () => false,
      () => false,
      dclProductHistoryPort,
    )
    await blocked.openVersions(row)
    await blocked.openAudit(row)
    expect(mockedPost).not.toHaveBeenCalled()

    mockedPost
      .mockRejectedValueOnce(new Error('versions unavailable'))
      .mockRejectedValueOnce(new Error('audit unavailable'))
    const history = useDclDeclarationHistory(
      errorMessage,
      () => true,
      () => true,
      dclProductHistoryPort,
    )
    await history.openVersions(row)
    expect(history.versionsLoading.value).toBe(false)
    expect(errorMessage.value).toBe('操作失败，请稍后重试。')
    await history.openAudit(row)
    expect(history.auditLoading.value).toBe(false)
    expect(errorMessage.value).toBe('操作失败，请稍后重试。')
  })
})
