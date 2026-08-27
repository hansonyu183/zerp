import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { getBobEntityConfig } from '@/pages/bob/shared/config'
import { useBobHistory } from '@/pages/bob/shared/history'
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
  objectRevision: 1,
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

describe('BOB history state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads version and audit pages with independent pagination', async () => {
    mockedPost
      .mockResolvedValueOnce({
        data: {
          items: [
            {
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
              summary: { name: '产品' },
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
    expect(mockedPost).toHaveBeenNthCalledWith(1, 'bob/product/versions', {
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
    expect(mockedPost).toHaveBeenNthCalledWith(3, 'bob/product/audit-history', {
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

  it('loads operating-entity history through DCL and normalizes typed snapshots', async () => {
    const operatingEntityRow: BobListItem = {
      ...row,
      entity: 'operating-entity',
      code: 'OPE-0001',
    }
    const approval = row.openVersion!.approval
    mockedPost
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              approval,
              data: { name: '申报经营主体', taxNumber: '91310000DCL' },
              enabled: true,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        },
      })
    const history = useBobHistory(
      getBobEntityConfig('operating-entity'),
      ref<string | null>(null),
      () => true,
      () => true,
    )

    await history.openVersions(operatingEntityRow)
    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'dcl/operating-entity/versions',
      {
        objectId: operatingEntityRow.objectId,
        page: 1,
        pageSize: 20,
      },
    )
    expect(history.versions.value[0]).toMatchObject({
      approvalEntryId: 'VERSION-1',
      summary: { name: '申报经营主体', taxNumber: '91310000DCL' },
    })

    await history.openAudit(operatingEntityRow)
    expect(mockedPost).toHaveBeenNthCalledWith(
      2,
      'dcl/operating-entity/audit-history',
      {
        objectId: operatingEntityRow.objectId,
        page: 1,
        pageSize: 20,
      },
    )
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
    expect(errorMessage.value).toBe('操作失败，请稍后重试。')
    await history.openAudit(row)
    expect(history.auditLoading.value).toBe(false)
    expect(errorMessage.value).toBe('操作失败，请稍后重试。')
  })
})
