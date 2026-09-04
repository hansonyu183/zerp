import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '../../../src/target/api.ts'
import { useTargetProbe } from '../../../src/target/vm.ts'

vi.mock('../../../src/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/target/api.ts')>()),
  queryTargetWorkbench: vi.fn(),
  reviewTargetArchive: vi.fn(),
  reviewTargetVou: vi.fn(),
  reviewTargetWarehouse: vi.fn(),
  reviewTargetWflDefinition: vi.fn(),
}))

const queryWorkbench = vi.mocked(targetApi.queryTargetWorkbench)
const reviewArchive = vi.mocked(targetApi.reviewTargetArchive)

function page(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('target approval workbench view model', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens with pending documents and only queries archives after their tab is selected', async () => {
    queryWorkbench.mockResolvedValue(page() as never)
    const vm = useTargetProbe()

    await vm.queryWorkbench('DOCUMENT', 1)

    expect(queryWorkbench).toHaveBeenLastCalledWith('', {
      page: 1,
      pageSize: 20,
      filters: { kind: 'DOCUMENT' },
    })
    expect(vm.workbenchActiveTab.value).toBe('DOCUMENT')

    vm.workbenchDocumentState.keyword = '销售'
    await vm.switchWorkbenchTab('ARCHIVE')

    expect(queryWorkbench).toHaveBeenLastCalledWith('', {
      page: 1,
      pageSize: 20,
      filters: { kind: 'ARCHIVE' },
    })
    expect(vm.workbenchDocumentState.keyword).toBe('销售')
    expect(vm.workbenchArchiveState.keyword).toBe('')
  })

  it('preserves filters after a failed query and exposes an explicit retry instead of an empty result', async () => {
    queryWorkbench.mockRejectedValueOnce(new Error('network'))
    const vm = useTargetProbe()
    vm.workbenchDocumentState.keyword = '保留'
    vm.workbenchDocumentState.entity = 'sales-order'
    vm.workbenchDocumentState.status = 'PENDING'

    await vm.applyWorkbenchFilters()

    expect(vm.workbenchDocumentState).toMatchObject({
      keyword: '保留',
      entity: 'sales-order',
      status: 'PENDING',
      page: 1,
      queryError: '工作台查询失败。',
    })
    queryWorkbench.mockResolvedValueOnce(page() as never)
    await vm.retryWorkbench()
    expect(vm.workbenchDocumentState.queryError).toBeNull()
  })

  it('keeps the newest response when same-tab queries resolve out of order', async () => {
    const first = deferred<ReturnType<typeof page>>()
    const second = deferred<ReturnType<typeof page>>()
    queryWorkbench.mockImplementationOnce(() => first.promise as never).mockImplementationOnce(() => second.promise as never)
    const vm = useTargetProbe()
    const oldQuery = vm.queryWorkbench('DOCUMENT', 1)
    vm.workbenchDocumentState.keyword = '最新条件'
    const newQuery = vm.queryWorkbench('DOCUMENT', 2)
    second.resolve(page({ total: 21, page: 2 }))
    await newQuery
    first.resolve(page({ total: 1, page: 1 }))
    await oldQuery
    expect(vm.workbenchDocumentState).toMatchObject({ total: 21, page: 2 })
    expect(vm.workbenchDocumentState.queryError).toBeNull()
  })

  it('resets applied filters to page one and corrects an expired page exactly once', async () => {
    queryWorkbench
      .mockResolvedValueOnce(page({ total: 21, page: 3 }) as never)
      .mockResolvedValueOnce(page({ total: 21, page: 2 }) as never)
    const vm = useTargetProbe()
    vm.workbenchDocumentState.page = 3
    vm.workbenchDocumentState.keyword = '过期页'

    await vm.queryWorkbench('DOCUMENT', 3)

    expect(queryWorkbench).toHaveBeenNthCalledWith(1, '', expect.objectContaining({ page: 3 }))
    expect(queryWorkbench).toHaveBeenNthCalledWith(2, '', expect.objectContaining({ page: 2 }))
    expect(vm.workbenchDocumentState.page).toBe(2)

    vm.workbenchDocumentState.entity = 'sales-order'
    vm.workbenchDocumentState.status = 'REJECTED'
    queryWorkbench.mockResolvedValueOnce(page() as never)
    await vm.resetWorkbenchFilters()
    expect(vm.workbenchDocumentState).toMatchObject({
      keyword: '', entity: '', status: '', page: 1,
    })
  })

  it('does not send an empty reject and refreshes the active tab after a review failure', async () => {
    queryWorkbench.mockResolvedValue(page() as never)
    reviewArchive.mockRejectedValueOnce(new Error('conflict'))
    const vm = useTargetProbe()
    const item = {
      domain: 'dcl' as const,
      entity: 'operating-entity',
      subjectOrDocumentId: 'subject-1',
      submissionId: 'submission-1',
      code: 'OPE-001',
      name: '主体',
      status: 'PENDING' as const,
      revision: 1,
      availableActions: ['reject'] as const,
      updatedAt: '2026-09-05T00:00:00.000Z',
    }

    await vm.reviewWorkbench(item, 'reject')
    expect(reviewArchive).not.toHaveBeenCalled()
    expect(vm.workbenchDocumentState.actionError).toBe('请填写驳回原因。')

    vm.workbenchReasons.value[item.submissionId] = '请补充附件'
    await vm.reviewWorkbench(item, 'reject')
    expect(reviewArchive).toHaveBeenCalledOnce()
    expect(queryWorkbench).toHaveBeenCalledOnce()
  })

  it('uses server-returned resource actions and hides view when edit is also present', () => {
    const vm = useTargetProbe()
    const item = {
      domain: 'dcl' as const, entity: 'product', subjectOrDocumentId: 'subject-1',
      submissionId: 'submission-1', code: 'PRD-001', name: '产品', status: 'REJECTED' as const,
      revision: '2', availableActions: ['view', 'edit', 'unreject'] as const,
      updatedAt: '2026-09-05T00:00:00.000Z',
    }
    expect(vm.visibleWorkbenchActions(item)).toEqual(['edit', 'unreject'])
    expect(vm.workbenchItemHref(item, 'edit')).toBe('/dcl/product?mode=edit&objectId=subject-1&approvalEntryId=submission-1&code=PRD-001')
    expect(vm.workbenchActionLabel('delete')).toBe('撤回')
  })
})
