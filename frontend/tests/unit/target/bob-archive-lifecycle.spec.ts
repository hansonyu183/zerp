import { describe, expect, it, vi } from 'vitest'

import { TargetApiError } from '@/target/api.ts'
import { useArchiveSubmissionLifecycle } from '@/target/pages/bob/archive/lifecycle.ts'
import { useArchiveSubmissionEditor } from '@/target/pages/bob/archive/submission.ts'

const candidate = {
  entity: 'supplier',
  subjectId: '01K4MQS6PTQDSYBEMC4T8ZYN4R',
  submissionId: '01K4MQS6PTQDSYBEMC4T8ZYN4S',
  code: 'SUP-0001',
  versionNo: 1,
  status: 'PENDING' as const,
  revision: '9',
  submittedBy: 'admin',
  submittedAt: '2026-09-07T00:00:00.000Z',
  approvedBy: null,
  approvedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  rejectionReason: null,
  availableApprovalActions: ['approve', 'reject'] as const,
  canDelete: true,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

function lifecycleOptions(overrides: Record<string, unknown> = {}) {
  return {
    canQuery: () => true,
    canGet: () => true,
    canVersions: () => true,
    canAudit: () => true,
    canAction: () => true,
    query: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1 }),
    get: vi.fn().mockResolvedValue({
      ...candidate,
      snapshot: { displayName: '北方供应商' },
    }),
    versions: vi.fn().mockResolvedValue({ items: [] }),
    auditHistory: vi.fn().mockResolvedValue([]),
    approve: vi.fn(),
    reject: vi.fn(),
    unreject: vi.fn(),
    unapprove: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  }
}

describe('archive submission lifecycle public seam', () => {
  it('queries the requested page and keyword and exposes the total', async () => {
    const query = vi.fn().mockResolvedValue({
      items: [],
      total: 41,
      page: 2,
      pageSize: 20,
    })
    const lifecycle = useArchiveSubmissionLifecycle(lifecycleOptions({ query }))

    await lifecycle.openList()
    await lifecycle.search(' 北方 ')
    await lifecycle.goToPage(2)

    expect(query).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 20,
      keyword: '',
    })
    expect(query).toHaveBeenNthCalledWith(2, {
      page: 1,
      pageSize: 20,
      keyword: '北方',
    })
    expect(query).toHaveBeenNthCalledWith(3, {
      page: 2,
      pageSize: 20,
      keyword: '北方',
    })
    expect(lifecycle.total.value).toBe(41)
    expect(lifecycle.page.value).toBe(2)
  })

  it('loads only authorized resources and selects an exact historical version', async () => {
    const get = vi.fn().mockResolvedValue({
      ...candidate,
      snapshot: { displayName: '北方供应商' },
    })
    const versions = vi.fn().mockResolvedValue({ items: [candidate] })
    const auditHistory = vi.fn()
    const lifecycle = useArchiveSubmissionLifecycle(
      lifecycleOptions({
        canAudit: () => false,
        get,
        versions,
        auditHistory,
      }),
    )

    await lifecycle.select({
      subjectId: candidate.subjectId,
      code: candidate.code,
      latestApproved: null,
      openCandidate: candidate,
    })
    await lifecycle.selectVersion(candidate)

    expect(get).toHaveBeenLastCalledWith({
      subjectId: candidate.subjectId,
      submissionId: candidate.submissionId,
    })
    expect(versions).toHaveBeenCalledWith(candidate.subjectId)
    expect(auditHistory).not.toHaveBeenCalled()
  })

  it('selects a version returned by the versions route without get permission', async () => {
    const historical = {
      ...candidate,
      status: 'APPROVED' as const,
      snapshot: { displayName: '历史版本' },
    }
    const get = vi.fn()
    const lifecycle = useArchiveSubmissionLifecycle(
      lifecycleOptions({ canGet: () => false, get }),
    )

    await lifecycle.selectVersion(historical)

    expect(lifecycle.selected.value).toBe(historical)
    expect(get).not.toHaveBeenCalled()
  })

  it('intersects the server action with its exact route permission', async () => {
    const lifecycle = useArchiveSubmissionLifecycle(
      lifecycleOptions({
        canAction: (action: string) =>
          action === 'reject' || action === 'delete',
      }),
    )
    await lifecycle.select({
      subjectId: candidate.subjectId,
      code: candidate.code,
      latestApproved: null,
      openCandidate: candidate,
    })

    expect(lifecycle.canAction('approve')).toBe(false)
    expect(lifecycle.canAction('reject')).toBe(true)
    expect(lifecycle.canAction('delete')).toBe(true)
  })

  it('keeps a successful write while reporting refresh failure separately', async () => {
    const approved = {
      ...candidate,
      status: 'APPROVED' as const,
      revision: '10',
      availableApprovalActions: ['unapprove'] as const,
      canDelete: false,
      snapshot: { displayName: '北方供应商' },
    }
    const query = vi
      .fn()
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockRejectedValueOnce(new Error('列表刷新失败'))
    const lifecycle = useArchiveSubmissionLifecycle(
      lifecycleOptions({ query, approve: vi.fn().mockResolvedValue(approved) }),
    )
    await lifecycle.openList()
    await lifecycle.select({
      subjectId: candidate.subjectId,
      code: candidate.code,
      latestApproved: null,
      openCandidate: candidate,
    })

    expect(await lifecycle.review('approve')).toBe('changed')
    expect(lifecycle.selected.value?.status).toBe('APPROVED')
    expect(lifecycle.error.value).toBeNull()
    expect(lifecycle.refreshError.value).toContain('列表刷新失败')
  })

  it('locks an unknown write until exact get verifies the outcome', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ ...candidate, snapshot: {} })
      .mockResolvedValueOnce({
        ...candidate,
        status: 'APPROVED',
        revision: '10',
        snapshot: {},
      })
    const approve = vi.fn().mockRejectedValue(new Error('连接中断'))
    const lifecycle = useArchiveSubmissionLifecycle(
      lifecycleOptions({ get, approve }),
    )
    await lifecycle.select({
      subjectId: candidate.subjectId,
      code: candidate.code,
      latestApproved: null,
      openCandidate: candidate,
    })

    await lifecycle.review('approve')
    await lifecycle.review('approve')
    expect(approve).toHaveBeenCalledTimes(1)
    expect(lifecycle.outcomeUnknown.value).toBe(true)
    expect(lifecycle.canVerifyOutcome.value).toBe(true)
    expect(await lifecycle.verifyOutcome()).toBe('changed')
    expect(lifecycle.outcomeUnknown.value).toBe(false)
  })

  it('invalidates old list requests when closed', async () => {
    const pending = deferred<{
      items: readonly never[]
      total: number
      page: number
    }>()
    const lifecycle = useArchiveSubmissionLifecycle(
      lifecycleOptions({ query: () => pending.promise }),
    )
    const opening = lifecycle.openList()
    lifecycle.close()
    pending.resolve({ items: [], total: 99, page: 1 })
    await opening

    expect(lifecycle.open.value).toBe(false)
    expect(lifecycle.total.value).toBe(0)
  })
})

describe('archive submission editor public seam', () => {
  it('rebuilds a deterministic API failure retry from the current draft', async () => {
    const submitNew = vi
      .fn()
      .mockRejectedValueOnce(
        new TargetApiError('approval_conflict', '冲突', 'request-1'),
      )
      .mockResolvedValueOnce({})
    const editor = useArchiveSubmissionEditor({
      createSnapshot: () => ({ legalName: '' }),
      validate: () => null,
      canSubmitNew: () => true,
      canSubmitChange: () => true,
      canGet: () => true,
      get: vi.fn(),
      versions: vi.fn(),
      submitNew,
      submitChange: vi.fn(),
    })
    editor.openCreate()
    editor.draft.value.legalName = '第一次输入'
    await editor.submit()
    const first = submitNew.mock.calls[0]![0]
    editor.draft.value.legalName = '后来修改'
    expect(await editor.submit()).toBe('changed')
    const retry = submitNew.mock.calls[1]![0]
    expect(retry.subjectId).toBe(first.subjectId)
    expect(retry.submissionId).not.toBe(first.submissionId)
    expect(retry.idempotencyKey).not.toBe(first.idempotencyKey)
    expect(retry.snapshot).toEqual({ legalName: '后来修改' })
  })

  it('treats an invalid response as an unknown submit result', async () => {
    const submitNew = vi
      .fn()
      .mockRejectedValue(
        new TargetApiError('invalid_response', '响应无效', 'request-1'),
      )
    const editor = useArchiveSubmissionEditor({
      createSnapshot: () => ({ legalName: '' }),
      validate: () => null,
      canSubmitNew: () => true,
      canSubmitChange: () => true,
      canGet: () => false,
      get: vi.fn(),
      versions: vi.fn(),
      submitNew,
      submitChange: vi.fn(),
    })
    editor.openCreate()

    await editor.submit()
    await editor.submit()

    expect(submitNew).toHaveBeenCalledTimes(1)
    expect(editor.outcomeUnknown.value).toBe(true)
    expect(editor.canVerifyOutcome.value).toBe(false)
  })

  it('locks an unknown submit and verifies it with the exact submission id', async () => {
    const get = vi.fn().mockResolvedValue({ submissionId: 'written' })
    const submitNew = vi.fn().mockRejectedValue(new Error('连接中断'))
    const editor = useArchiveSubmissionEditor({
      createSnapshot: () => ({ legalName: '' }),
      validate: () => null,
      canSubmitNew: () => true,
      canSubmitChange: () => true,
      canGet: () => true,
      get,
      versions: vi.fn(),
      submitNew,
      submitChange: vi.fn(),
    })
    editor.openCreate()
    await editor.submit()
    const command = submitNew.mock.calls[0]![0]
    await editor.submit()
    expect(submitNew).toHaveBeenCalledTimes(1)
    expect(await editor.verifyOutcome()).toBe('changed')
    expect(get).toHaveBeenCalledWith({
      subjectId: command.subjectId,
      submissionId: command.submissionId,
    })
  })

  it('does not let an obsolete change request reopen the editor', async () => {
    const pending = deferred<{
      items: readonly (typeof candidate & {
        snapshot: { legalName: string }
      })[]
    }>()
    const editor = useArchiveSubmissionEditor({
      createSnapshot: () => ({ legalName: '' }),
      validate: () => null,
      canSubmitNew: () => true,
      canSubmitChange: () => true,
      canGet: () => true,
      get: vi.fn(),
      versions: () => pending.promise,
      submitNew: vi.fn(),
      submitChange: vi.fn(),
    })
    const opening = editor.openChange('subject-1')
    editor.close()
    pending.resolve({
      items: [{ ...candidate, snapshot: { legalName: '旧值' } }],
    })
    await opening

    expect(editor.open.value).toBe(false)
    expect(editor.draft.value.legalName).toBe('')
  })

  it('keeps the change dialog open with a visible versions read failure', async () => {
    const editor = useArchiveSubmissionEditor({
      createSnapshot: () => ({ legalName: '' }),
      validate: () => null,
      canSubmitNew: () => true,
      canSubmitChange: () => true,
      canGet: () => true,
      get: vi.fn(),
      versions: vi.fn().mockRejectedValue(new Error('版本读取失败')),
      submitNew: vi.fn(),
      submitChange: vi.fn(),
    })

    await editor.openChange('subject-1')

    expect(editor.open.value).toBe(true)
    expect(editor.canSubmit.value).toBe(false)
    expect(editor.error.value).toBe('版本读取失败')
  })

  it('pairs the latest approved revision with that exact version snapshot', async () => {
    const submitChange = vi.fn().mockResolvedValue({})
    const editor = useArchiveSubmissionEditor({
      createSnapshot: () => ({ legalName: '' }),
      validate: () => null,
      canSubmitNew: () => true,
      canSubmitChange: () => true,
      canGet: () => true,
      get: vi.fn(),
      versions: vi.fn().mockResolvedValue({
        items: [
          {
            ...candidate,
            status: 'APPROVED',
            versionNo: 1,
            revision: '10',
            snapshot: { legalName: '列表中的旧版本' },
          },
          {
            ...candidate,
            submissionId: 'approved-v2',
            status: 'APPROVED',
            versionNo: 2,
            revision: '20',
            snapshot: { legalName: '最新批准版本' },
          },
        ],
      }),
      submitNew: vi.fn(),
      submitChange,
    })

    await editor.openChange(candidate.subjectId)
    expect(editor.draft.value).toEqual({ legalName: '最新批准版本' })
    await editor.submit()

    expect(submitChange).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedLatestApprovedSubmissionId: 'approved-v2',
        expectedLatestApprovedRevision: '20',
        snapshot: { legalName: '最新批准版本' },
      }),
    )
  })
})
