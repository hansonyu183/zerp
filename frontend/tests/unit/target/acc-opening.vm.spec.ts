import { describe, expect, it, vi } from 'vitest'

import {
  createAccOpeningViewModel,
  type AccOpeningDraft,
  type AccOpeningReferenceCandidate,
} from '@/target/pages/acc/opening/vm.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const draft: AccOpeningDraft = {
  entity: 'acc-opening',
  draftId: '01K4A000000000000000000011',
  ownerUserId: 'user-1',
  updatedAt: '2026-09-05T08:00:00.000Z',
  bookId: '01K4A000000000000000000001',
  submissionId: '01K4A000000000000000000012',
  lines: [],
  assets: [],
  bills: [],
  containers: [],
}

function ports() {
  return {
    books: vi.fn().mockResolvedValue({
      items: [
        {
          id: draft.bookId,
          code: 'ACC-0001',
          name: '控制账簿',
          description: '',
          startMonth: '2026-08',
          baseCurrency: 'CNY',
          controlBook: true,
          revision: '1',
          queryUserIds: [],
          operateUserIds: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 200,
    }),
    subjects: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 }),
    opening: vi.fn().mockResolvedValue(null),
    references: vi.fn().mockResolvedValue({ items: [] }),
    submit: vi.fn(),
    review: vi.fn(),
    deleteSubmission: vi.fn(),
    drafts: {
      list: vi.fn().mockResolvedValue([structuredClone(draft)]),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    id: () => '01K4A000000000000000000099',
    now: () => '2026-09-05T09:00:00.000Z',
  }
}

describe('ACC opening public view-model seam', () => {
  it('uses server-filtered typed reference candidates and ignores late searches per entity', async () => {
    const api = ports()
    const oldAssets = deferred<{
      items: AccOpeningReferenceCandidate[]
    }>()
    api.references
      .mockReturnValueOnce(oldAssets.promise)
      .mockResolvedValueOnce({
        items: [
          {
            entity: 'asset' as const,
            objectId: 'asset-new',
            code: 'FA-002',
            name: '新资产',
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            entity: 'bill' as const,
            objectId: 'bill-1',
            code: 'BILL-001',
            name: '银行承兑',
          },
        ],
      })
    const vm = createAccOpeningViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/subject/query',
          '/acc/opening/query',
          '/vou/reference/query',
        ],
      },
      api,
    )

    const firstAssetSearch = vm.loadReference('asset', '旧')
    await vm.loadReference('asset', '新')
    await vm.loadReference('bill', '票据')
    oldAssets.resolve({
      items: [
        {
          entity: 'asset',
          objectId: 'asset-old',
          code: 'FA-001',
          name: '旧资产',
        },
      ],
    })
    await firstAssetSearch

    expect(api.references).toHaveBeenNthCalledWith(1, 'csrf-token', {
      entity: 'asset',
      keyword: '旧',
    })
    expect(vm.referenceOptions.value.asset).toEqual([
      {
        entity: 'asset',
        objectId: 'asset-new',
        code: 'FA-002',
        name: '新资产',
      },
    ])
    expect(vm.referenceOptions.value.bill).toEqual([
      {
        entity: 'bill',
        objectId: 'bill-1',
        code: 'BILL-001',
        name: '银行承兑',
      },
    ])
    expect(vm.referenceEntity('CUSTOMER_SUBUNIT')).toBe('customer-subunit')
  })

  it('adds a container only from a typed customer-subunit candidate snapshot', async () => {
    const api = ports()
    const candidate = {
      entity: 'customer-subunit' as const,
      objectId: '01K4A000000000000000000021',
      customerId: '01K4A000000000000000000022',
      approvalEntryId: '01K4A000000000000000000023',
      code: 'SUB-0001',
      name: '总部',
    }
    api.references.mockResolvedValue({ items: [candidate] })
    const vm = createAccOpeningViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/subject/query',
          '/acc/opening/query',
          '/acc/opening/submit-new',
          '/vou/reference/query',
        ],
      },
      api,
    )
    const localDraft = structuredClone(draft)

    vm.addContainer(localDraft)
    expect(localDraft.containers).toEqual([])
    expect(vm.error.value).toBe('请选择客户子单位。')

    await vm.loadReference('customer-subunit', '总部')
    expect(api.references).toHaveBeenCalledWith('csrf-token', {
      entity: 'customer-subunit',
      keyword: '总部',
    })
    expect(vm.customerSubunitOptions.value).toEqual([candidate])
    vm.selectedContainerSubunit.value =
      vm.customerSubunitOptions.value[0] ?? null

    vm.addContainer(localDraft)

    expect(localDraft.containers).toEqual([
      {
        subunit: { ...candidate },
        containerType: 'SOLVENT',
        quantity: 1,
      },
    ])
    expect(localDraft.containers[0]?.subunit).not.toBe(candidate)
    expect(vm.selectedContainerSubunit.value).toBeNull()
  })

  it('persists before submit and retains the local Draft when submission fails', async () => {
    const api = ports()
    api.submit.mockRejectedValue(new Error('期初借贷不平衡'))
    const vm = createAccOpeningViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/subject/query',
          '/acc/opening/query',
          '/acc/opening/submit-new',
        ],
      },
      api,
    )
    await vm.initialize()

    await vm.submitDraft(vm.drafts.value[0]!)

    expect(api.drafts.save).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: '2026-09-05T09:00:00.000Z' }),
    )
    expect(api.drafts.delete).not.toHaveBeenCalled()
    expect(vm.drafts.value).toHaveLength(1)
    expect(vm.error.value).toBe('期初借贷不平衡')
  })

  it('offers and executes only approval actions returned by the server', async () => {
    const api = ports()
    api.opening.mockResolvedValue({
      bookId: draft.bookId,
      submissionId: draft.submissionId,
      approval: {
        id: draft.submissionId,
        domain: 'acc',
        entity: 'opening',
        subjectId: draft.bookId,
        versionNo: null,
        status: 'PENDING',
        revision: '2',
        metadata: {
          submitted: {
            actorId: 'user-1',
            occurredAt: '2026-09-05T08:00:00.000Z',
          },
        },
      },
      payload: {
        bookId: draft.bookId,
        submissionId: draft.submissionId,
        idempotencyKey: draft.submissionId,
        lines: [],
        assets: [],
        bills: [],
        containers: [],
      },
      availableApprovalActions: ['reject'],
    })
    api.review.mockResolvedValue({})
    const vm = createAccOpeningViewModel(
      {
        ownerUserId: 'user-2',
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/subject/query',
          '/acc/opening/query',
          '/acc/opening/reject',
          '/acc/opening/approve',
        ],
      },
      api,
    )
    await vm.initialize()

    expect(vm.canReview('reject')).toBe(true)
    expect(vm.canReview('approve')).toBe(false)
    vm.reason.value = '资料不完整'
    await vm.review('reject')

    expect(api.review).toHaveBeenCalledWith('csrf-token', 'reject', {
      bookId: draft.bookId,
      submissionId: draft.submissionId,
      expectedRevision: '2',
      reason: '资料不完整',
    })
  })

  it('refreshes the server action snapshot after a rejected approval action', async () => {
    const api = ports()
    const pending = {
      bookId: draft.bookId,
      submissionId: draft.submissionId,
      approval: {
        id: draft.submissionId,
        domain: 'acc' as const,
        entity: 'opening' as const,
        subjectId: draft.bookId,
        versionNo: null,
        status: 'PENDING' as const,
        revision: '2',
        metadata: {
          submitted: {
            actorId: 'user-1',
            occurredAt: '2026-09-05T08:00:00.000Z',
          },
        },
      },
      payload: {
        bookId: draft.bookId,
        submissionId: draft.submissionId,
        idempotencyKey: draft.submissionId,
        lines: [],
        assets: [],
        bills: [],
        containers: [],
      },
      availableApprovalActions: ['approve'] as const,
    }
    api.opening.mockResolvedValueOnce(pending).mockResolvedValueOnce({
      ...pending,
      approval: { ...pending.approval, revision: '3' },
      availableApprovalActions: [],
    })
    api.review.mockRejectedValue(new Error('审批条目已变化'))
    const vm = createAccOpeningViewModel(
      {
        ownerUserId: 'user-2',
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/subject/query',
          '/acc/opening/query',
          '/acc/opening/approve',
        ],
      },
      api,
    )
    await vm.initialize()

    await vm.review('approve')

    expect(vm.opening.value?.approval.revision).toBe('3')
    expect(vm.opening.value?.availableApprovalActions).toEqual([])
    expect(vm.error.value).toBe('审批条目已变化')
  })
})
