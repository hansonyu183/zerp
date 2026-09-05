import { describe, expect, it, vi } from 'vitest'

import { createArchiveWorkspaceViewModel } from '@/target/pages/dcl/shared/vm.ts'
import { archiveSubmitPermissions } from '@/target/archive-presentation.ts'
import { ordinaryArchiveConfigs } from '@/target/pages/dcl/shared/config.ts'

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
      submit: vi.fn(),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
      auxReference: vi.fn().mockResolvedValue([]),
      bobReference: vi.fn().mockResolvedValue([]),
    },
    now: () => '2026-09-05T09:00:00.000Z',
  }
}

describe('Ordinary DCL archive public view-model seam', () => {
  it('registers typed page configuration for exactly the seven ordinary archives', () => {
    expect(Object.keys(ordinaryArchiveConfigs)).toEqual([
      'operating-entity',
      'vehicle',
      'fund-account',
      'employee',
      'supplier',
      'other-unit',
      'sales-partner',
    ])
    for (const [entity, config] of Object.entries(ordinaryArchiveConfigs)) {
      expect(config.route).toBe(`/dcl/${entity}`)
      expect(config.useCaseKey).toBe(`dcl/${entity}`)
      expect(config.fields.length).toBeGreaterThan(0)
    }
  })

  it('uses the fixed query page and ignores a stale response', async () => {
    const dependencies = ports()
    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    dependencies.api.query
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)))
    const vm = createArchiveWorkspaceViewModel(
      'supplier',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/dcl/supplier/query'],
      },
      dependencies,
    )

    vm.filters.keyword = '旧供应商'
    const first = vm.query(1)
    vm.filters.keyword = '新供应商'
    const second = vm.query(2)
    resolveSecond({ items: [], total: 21 })
    await second
    resolveFirst({ items: [], total: 1 })
    await first

    expect(dependencies.api.query).toHaveBeenNthCalledWith(2, 'csrf-token', {
      entity: 'supplier',
      input: {
        page: 2,
        pageSize: 20,
        filters: { keyword: '新供应商' },
      },
    })
    expect(vm.page.value).toBe(2)
    expect(vm.total.value).toBe(21)
  })

  for (const entity of [
    'operating-entity',
    'vehicle',
    'fund-account',
    'employee',
    'supplier',
    'other-unit',
    'sales-partner',
  ] as const) {
    it(`${entity} keeps the local draft when submit fails`, async () => {
      const dependencies = ports()
      dependencies.api.submit.mockRejectedValue(new Error('提交失败'))
      const vm = createArchiveWorkspaceViewModel(
        entity,
        {
          ownerUserId: 'user-1',
          csrfToken: 'csrf-token',
          permissions: archiveSubmitPermissions(entity, 'NEW'),
        },
        dependencies,
      )
      await vm.newDraft()
      const draft = vm.drafts.value[0]!
      await vm.submitDraft(draft)
      const expectedSnapshot = {
        'operating-entity': { legalName: '新经营主体' },
        vehicle: { name: '新车辆' },
        'fund-account': { name: '新资金账户', currency: 'CNY' },
        employee: { displayName: '新员工', identityKind: 'PERSON' },
        supplier: { displayName: '新供应商' },
        'other-unit': { displayName: '新其他单位' },
        'sales-partner': {
          displayName: '新销售合作方',
          capabilities: ['CHANNEL_PARTNER'],
        },
      }[entity]

      expect(dependencies.api.submit).toHaveBeenCalledWith(
        'csrf-token',
        expect.objectContaining({
          entity,
          mode: 'NEW',
          input: expect.objectContaining({
            snapshot: expect.objectContaining(expectedSnapshot),
          }),
        }),
      )
      expect(dependencies.drafts.delete).not.toHaveBeenCalled()
      expect(vm.drafts.value).toHaveLength(1)
      expect(vm.error.value).toContain('提交失败')
    })
  }

  it('deletes only the submitted local draft after server success', async () => {
    const dependencies = ports()
    dependencies.api.submit.mockResolvedValue({ status: 'PENDING' })
    dependencies.api.query.mockResolvedValue({ items: [], total: 0 })
    const vm = createArchiveWorkspaceViewModel(
      'operating-entity',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: [
          ...archiveSubmitPermissions('operating-entity', 'NEW'),
          '/dcl/operating-entity/query',
        ],
      },
      dependencies,
    )
    await vm.newDraft()
    await vm.newDraft()
    const submitted = vm.drafts.value[0]!
    const retained = vm.drafts.value[1]!

    await vm.submitDraft(submitted)

    expect(dependencies.drafts.delete).toHaveBeenCalledWith(
      'user-1',
      'operating-entity',
      submitted.draftId,
    )
    expect(vm.drafts.value.map((draft) => draft.draftId)).toEqual([
      retained.draftId,
    ])
  })

  it('opens the exact workbench Submission without depending on the current list page', async () => {
    const dependencies = ports()
    const exactSubmission = {
      subjectId: 'subject-off-page',
      code: 'SUP-0021',
      submissionId: 'submission-exact',
      versionNo: 2,
      status: 'REJECTED',
      revision: '7',
      availableApprovalActions: ['unreject'],
      canDelete: true,
      snapshot: { displayName: '第二十一页供应商' },
    }
    dependencies.api.get.mockResolvedValue(exactSubmission)
    dependencies.api.versions.mockResolvedValue({ items: [exactSubmission] })
    dependencies.api.audit.mockResolvedValue({ items: [] })
    const vm = createArchiveWorkspaceViewModel(
      'supplier',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/dcl/supplier/get', '/dcl/supplier/versions'],
      },
      dependencies,
    )

    await vm.synchronizeDeepLink({
      objectId: 'subject-off-page',
      submissionId: 'submission-exact',
      revision: '7',
      mode: 'view',
    })

    expect(dependencies.api.query).not.toHaveBeenCalled()
    expect(vm.history.value?.detail).toMatchObject({
      submissionId: 'submission-exact',
      revision: '7',
      snapshot: { displayName: '第二十一页供应商' },
    })
  })

  it('trusts server approval actions and refreshes the open detail after a failed action', async () => {
    const dependencies = ports()
    const submission = {
      subjectId: 'subject-1',
      code: 'SUP-0001',
      submissionId: 'submission-1',
      versionNo: 1,
      status: 'PENDING',
      revision: '1',
      availableApprovalActions: ['approve'],
      canDelete: true,
      snapshot: { displayName: '供应商一' },
    }
    dependencies.api.get.mockResolvedValue(submission)
    dependencies.api.versions.mockResolvedValue({ items: [submission] })
    dependencies.api.audit.mockResolvedValue({ items: [] })
    dependencies.api.query.mockResolvedValue({ items: [submission], total: 1 })
    dependencies.api.review.mockRejectedValue(new Error('版本冲突'))
    const vm = createArchiveWorkspaceViewModel(
      'supplier',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/dcl/supplier/query'],
      },
      dependencies,
    )
    await vm.viewHistory(submission)

    await vm.review(submission, 'approve')

    expect(dependencies.api.review).toHaveBeenCalledOnce()
    expect(dependencies.api.query).toHaveBeenCalledOnce()
    expect(dependencies.api.get).toHaveBeenCalledTimes(2)
    expect(vm.error.value).toBe('版本冲突')
  })

  it('ignores an older reference response that arrives last', async () => {
    const dependencies = ports()
    let resolveFirst!: (value: unknown[]) => void
    let resolveSecond!: (value: unknown[]) => void
    dependencies.api.bobReference
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)))
    const vm = createArchiveWorkspaceViewModel(
      'fund-account',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/bob/reference/query'],
      },
      dependencies,
    )

    const first = vm.loadReferences()
    const second = vm.loadReferences()
    resolveSecond([{ objectId: 'new', name: '新经营主体' }])
    await second
    resolveFirst([{ objectId: 'old', name: '旧经营主体' }])
    await first

    expect(vm.referenceOptions.value.operatingEntity).toEqual([
      { objectId: 'new', name: '新经营主体' },
    ])
  })
})
