import { describe, expect, it, vi } from 'vitest'

import { createWarehouseViewModel } from '@/target/pages/dcl/warehouse/vm.ts'
import type { WarehouseDraft } from '@/target/warehouse-drafts.ts'

const draft: WarehouseDraft = {
  entity: 'warehouse',
  draftId: 'DRAFT000000000000000000000',
  ownerUserId: 'user-1',
  mode: 'NEW',
  subjectId: 'SUBJECT0000000000000000000',
  submissionId: 'SUBMIT0000000000000000000',
  idempotencyKey: 'SUBMIT0000000000000000000',
  expectedLatestApprovedSubmissionId: null,
  expectedLatestApprovedRevision: null,
  snapshot: {
    name: '一号仓',
    address: '',
    contactName: '',
    contactPhone: '',
    managerEmployeeId: '',
    managerEmployeeApprovalEntryId: '',
    managerEmployeeCode: '',
    managerEmployeeName: '',
    remark: '',
    enabled: true,
  },
  updatedAt: '2026-09-05T07:00:00.000Z',
}

function ports() {
  return {
    drafts: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    api: {
      query: vi.fn(),
      get: vi.fn(),
      versions: vi.fn(),
      audit: vi.fn(),
      managerReference: vi.fn(),
      managerCandidates: vi.fn().mockResolvedValue([]),
      submit: vi.fn(),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
    },
    now: () => '2026-09-05T08:00:00.000Z',
  }
}

describe('Warehouse public view-model seam', () => {
  it('queries explicitly and ignores an older response that arrives last', async () => {
    const dependencies = ports()
    let resolveFirst!: (value: {
      items: never[]
      total: number
      page: number
      pageSize: 20
    }) => void
    let resolveSecond!: typeof resolveFirst
    dependencies.api.query
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
      )
    const vm = createWarehouseViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/dcl/warehouse/query'],
      },
      dependencies,
    )

    expect(dependencies.api.query).not.toHaveBeenCalled()
    vm.filters.keyword = '旧仓'
    const first = vm.query(1)
    vm.filters.keyword = '新仓'
    const second = vm.query(2)
    resolveSecond({ items: [], total: 21, page: 2, pageSize: 20 })
    await second
    resolveFirst({ items: [], total: 1, page: 1, pageSize: 20 })
    await first

    expect(dependencies.api.query).toHaveBeenNthCalledWith(2, 'csrf-token', {
      page: 2,
      pageSize: 20,
      filters: { keyword: '新仓' },
    })
    expect(vm.page.value).toBe(2)
    expect(vm.total.value).toBe(21)
    expect(vm.loading.value).toBe(false)
  })

  it('serializes autosave per draft and flushes the latest edit before submit', async () => {
    vi.useFakeTimers()
    const dependencies = ports()
    dependencies.drafts.list.mockResolvedValue([draft])
    dependencies.api.query.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    dependencies.api.submit.mockResolvedValue({
      subjectId: draft.subjectId,
      code: 'WHS-000001',
      submissionId: draft.submissionId,
      versionNo: 1,
      status: 'PENDING',
      revision: '1',
      snapshot: draft.snapshot,
      availableApprovalActions: [],
      canDelete: true,
    })
    const vm = createWarehouseViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/dcl/warehouse/query', '/dcl/warehouse/submit-new'],
      },
      dependencies,
    )
    await vm.loadDrafts()
    vm.drafts.value[0]!.snapshot.name = '最终仓名'
    vm.scheduleSave(vm.drafts.value[0]!)

    expect(dependencies.drafts.save).not.toHaveBeenCalled()
    await vm.submitDraft(vm.drafts.value[0]!)

    expect(dependencies.drafts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: '2026-09-05T08:00:00.000Z',
        snapshot: expect.objectContaining({ name: '最终仓名' }),
      }),
    )
    expect(dependencies.api.submit).toHaveBeenCalledWith(
      'csrf-token',
      'NEW',
      expect.objectContaining({
        snapshot: expect.objectContaining({ name: '最终仓名', address: null }),
      }),
    )
    expect(dependencies.drafts.delete).toHaveBeenCalledWith(
      'user-1',
      draft.draftId,
    )
    vi.useRealTimers()
  })

  it('retains the local draft when submission fails', async () => {
    const dependencies = ports()
    dependencies.drafts.list.mockResolvedValue([draft])
    dependencies.api.submit.mockRejectedValue(new Error('服务不可用'))
    const vm = createWarehouseViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/dcl/warehouse/submit-new'],
      },
      dependencies,
    )
    await vm.loadDrafts()
    await vm.submitDraft(vm.drafts.value[0]!)

    expect(dependencies.drafts.delete).not.toHaveBeenCalled()
    expect(vm.drafts.value).toHaveLength(1)
    expect(vm.error.value).toContain('服务不可用')
  })

  it('clones an open V1 from the exact versions snapshot instead of the snapshot-free list row', async () => {
    const dependencies = ports()
    dependencies.api.versions.mockResolvedValue({
      items: [
        {
          subjectId: draft.subjectId,
          code: 'WHS-000001',
          submissionId: draft.submissionId,
          versionNo: 1,
          status: 'PENDING',
          revision: '1',
          snapshot: { ...draft.snapshot, name: '服务器候选仓' },
          availableApprovalActions: [],
          canDelete: true,
        },
      ],
      total: 1,
    })
    const vm = createWarehouseViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/dcl/warehouse/get', '/dcl/warehouse/submit-change'],
      },
      dependencies,
    )
    await vm.cloneSubmission({
      subjectId: draft.subjectId,
      code: 'WHS-000001',
      submissionId: draft.submissionId,
      versionNo: 1,
      status: 'PENDING',
      revision: '1',
      availableApprovalActions: [],
      canDelete: true,
    })

    expect(dependencies.drafts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'NEW',
        snapshot: expect.objectContaining({ name: '服务器候选仓' }),
      }),
    )
  })

  it('opens an exact workbench version without requiring the subject on page one', async () => {
    const dependencies = ports()
    const exact = {
      subjectId: draft.subjectId,
      code: 'WHS-0021',
      submissionId: draft.submissionId,
      versionNo: 2,
      status: 'REJECTED' as const,
      revision: '8',
      snapshot: { ...draft.snapshot, name: '第二十一页仓库' },
      availableApprovalActions: ['unreject' as const],
      canDelete: true,
    }
    dependencies.api.get.mockResolvedValue(exact)
    dependencies.api.versions.mockResolvedValue({ items: [exact], total: 1 })
    dependencies.api.audit.mockResolvedValue({ items: [] })
    const vm = createWarehouseViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/dcl/warehouse/get'],
      },
      dependencies,
    )

    await vm.synchronizeDeepLink({
      objectId: draft.subjectId,
      submissionId: draft.submissionId,
      revision: '8',
      mode: 'view',
    })

    expect(dependencies.api.query).not.toHaveBeenCalled()
    expect(vm.history.value?.detail).toMatchObject({
      submissionId: draft.submissionId,
      revision: '8',
      snapshot: expect.objectContaining({ name: '第二十一页仓库' }),
    })
  })
})
