import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { getBobEntityConfig } from '@/pages/bob/shared/config'
import { useBobHistory } from '@/pages/bob/shared/history'
import type { BobListItem } from '@/pages/bob/shared/types'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}))

const mockedPost = vi.mocked(apiClient.post)

const row: BobListItem = {
  objectId: 'OBJECT-1',
  entity: 'product',
  code: 'PRODUCT-1',
  objectRevision: 1,
  effectiveVersionId: null,
  currentVersion: {
    versionId: 'VERSION-1',
    version: 1,
    status: 'DRAFT',
    revision: 1,
    summary: { name: '产品' },
  },
  updatedAt: '2026-07-26T00:00:00Z',
}

describe('BOB history state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads version and audit pages with independent pagination', async () => {
    mockedPost
      .mockResolvedValueOnce({
        data: {
          items: [{
            versionId: 'VERSION-1',
            version: 1,
            status: 'DRAFT',
            revision: 1,
            summary: { name: '产品' },
          }],
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
          items: [{
            id: 'EVENT-1',
            objectId: row.objectId,
            versionId: 'VERSION-1',
            entity: 'product',
            eventType: 'CREATED',
            fromStatus: null,
            toStatus: 'DRAFT',
            actorId: 'USER-1',
            occurredAt: '2026-07-26T00:00:00Z',
            comment: null,
            requestId: 'REQUEST-1',
            summary: null,
          }],
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
    const history = useBobHistory(
      getBobEntityConfig('product'),
      errorMessage,
      () => true,
      () => true,
    )

    await history.openVersions(row)
    expect(history.versionsOpen.value).toBe(true)
    expect(history.versions.value).toHaveLength(1)
    expect(history.versionsTotal.value).toBe(2)
    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'bob/product/versions',
      { objectId: row.objectId, page: 1, pageSize: 20 },
    )
    await history.changeVersionsPage(1)
    await history.changeVersionsPage(0)
    expect(mockedPost).toHaveBeenCalledTimes(1)
    await history.changeVersionsPage(2)
    expect(history.versionsPage.value).toBe(2)

    await history.openAudit(row)
    expect(history.auditOpen.value).toBe(true)
    expect(history.auditEvents.value).toHaveLength(1)
    expect(mockedPost).toHaveBeenNthCalledWith(
      3,
      'bob/product/audit-history',
      { objectId: row.objectId, page: 1, pageSize: 20 },
    )
    await history.changeAuditPage(1)
    await history.changeAuditPage(0)
    expect(mockedPost).toHaveBeenCalledTimes(3)
    await history.changeAuditPage(2)
    expect(history.auditPage.value).toBe(2)
    expect(errorMessage.value).toBeNull()
  })

  it('honors permissions and reports request failures', async () => {
    const errorMessage = ref<string | null>(null)
    const blocked = useBobHistory(
      getBobEntityConfig('product'),
      errorMessage,
      () => false,
      () => false,
    )
    await blocked.openVersions(row)
    await blocked.openAudit(row)
    expect(mockedPost).not.toHaveBeenCalled()

    mockedPost
      .mockRejectedValueOnce(new Error('versions unavailable'))
      .mockRejectedValueOnce(new Error('audit unavailable'))
    const history = useBobHistory(
      getBobEntityConfig('product'),
      errorMessage,
      () => true,
      () => true,
    )
    await history.openVersions(row)
    expect(history.versionsLoading.value).toBe(false)
    expect(errorMessage.value).toBe('versions unavailable')
    await history.openAudit(row)
    expect(history.auditLoading.value).toBe(false)
    expect(errorMessage.value).toBe('audit unavailable')
  })
})
