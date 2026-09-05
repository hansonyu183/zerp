import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import { useDashboardViewModel } from '@/target/pages/home/dashboard/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  queryTargetWorkbench: vi.fn(),
  reviewTargetArchive: vi.fn(),
}))

const queryWorkbench = vi.mocked(targetApi.queryTargetWorkbench)
const reviewArchive = vi.mocked(targetApi.reviewTargetArchive)
const page = (overrides: Record<string, unknown> = {}) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  ...overrides,
})

describe('formal approval workbench view model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useTargetSession().csrfToken = 'csrf-token'
  })

  it('queries documents first and preserves their filters when archives are selected', async () => {
    queryWorkbench.mockResolvedValue(page() as never)
    const vm = useDashboardViewModel()
    vm.documents.keyword = '销售'
    await vm.query('DOCUMENT', 1)
    await vm.switchTab('ARCHIVE')

    expect(queryWorkbench).toHaveBeenNthCalledWith(1, 'csrf-token', {
      page: 1,
      pageSize: 20,
      filters: { kind: 'DOCUMENT', keyword: '销售' },
    })
    expect(queryWorkbench).toHaveBeenNthCalledWith(2, 'csrf-token', {
      page: 1,
      pageSize: 20,
      filters: { kind: 'ARCHIVE' },
    })
    expect(vm.documents.keyword).toBe('销售')
  })

  it('preserves filters after a failed query and supports explicit retry', async () => {
    queryWorkbench.mockRejectedValueOnce(new Error('network'))
    const vm = useDashboardViewModel()
    vm.documents.keyword = '保留'
    vm.documents.entity = 'sales-order'
    vm.documents.status = 'PENDING'
    await vm.applyFilters()
    expect(vm.documents).toMatchObject({
      keyword: '保留',
      entity: 'sales-order',
      status: 'PENDING',
      queryError: 'network',
    })
    queryWorkbench.mockResolvedValueOnce(page() as never)
    await vm.retry()
    expect(vm.documents.queryError).toBeNull()
  })

  it('uses server actions and requires a reason before rejecting', async () => {
    queryWorkbench.mockResolvedValue(page() as never)
    const vm = useDashboardViewModel()
    const item = {
      domain: 'dcl' as const,
      entity: 'operating-entity',
      subjectOrDocumentId: 'subject-1',
      submissionId: 'submission-1',
      code: 'OPE-001',
      name: '主体',
      status: 'PENDING' as const,
      revision: '1',
      availableActions: ['view', 'edit', 'reject'] as const,
      updatedAt: '2026-09-05T00:00:00.000Z',
    }
    expect(vm.visibleActions(item)).toEqual(['edit', 'reject'])
    await vm.review(item, 'reject')
    expect(reviewArchive).not.toHaveBeenCalled()
    expect(vm.documents.actionError).toBe('请填写驳回原因。')
    vm.reasons.value[item.submissionId] = '请补充附件'
    await vm.review(item, 'reject')
    expect(reviewArchive).toHaveBeenCalledOnce()
  })

  it('carries exact submission and revision context in workbench deep links', () => {
    const vm = useDashboardViewModel()
    const archive = {
      domain: 'dcl' as const,
      entity: 'customer',
      subjectOrDocumentId: 'customer-1',
      submissionId: 'submission-2',
      code: 'CUS-001',
      name: '客户',
      status: 'REJECTED' as const,
      revision: '7',
      availableActions: ['edit'] as const,
      updatedAt: '2026-09-05T00:00:00.000Z',
    }
    const voucher = {
      ...archive,
      domain: 'vou' as const,
      entity: 'sale-order',
      subjectOrDocumentId: 'document-1',
    }

    const archiveUrl = new URL(
      vm.itemHref(archive, 'edit'),
      'https://zerp.test',
    )
    expect(archiveUrl.pathname).toBe('/dcl/customer')
    expect(Object.fromEntries(archiveUrl.searchParams)).toEqual({
      mode: 'edit',
      objectId: 'customer-1',
      submissionId: 'submission-2',
      revision: '7',
      code: 'CUS-001',
    })
    const voucherUrl = new URL(
      vm.itemHref(voucher, 'view'),
      'https://zerp.test',
    )
    expect(voucherUrl.pathname).toBe('/vou/sale-order')
    expect(Object.fromEntries(voucherUrl.searchParams)).toEqual({
      mode: 'view',
      documentId: 'document-1',
      submissionId: 'submission-2',
      revision: '7',
    })
  })
})
