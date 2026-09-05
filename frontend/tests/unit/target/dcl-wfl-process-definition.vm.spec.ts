import { describe, expect, it, vi } from 'vitest'

import { createDclWflProcessDefinitionViewModel } from '@/target/pages/dcl/wfl-process-definition/vm.ts'

describe('DCL WFL definition public view-model seam', () => {
  it('keeps Starlark and typed trial document in a local Draft when submit fails', async () => {
    const ports = {
      drafts: {
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        delete: vi.fn(),
      },
      query: vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      get: vi.fn(),
      submit: vi.fn().mockRejectedValue(new Error('试算不通过')),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
      setEnabled: vi.fn(),
      trial: vi.fn(),
      queryDocuments: vi.fn().mockResolvedValue([
        {
          documentId: '01K4A000000000000000000020',
          documentNo: 'PO-0001',
          status: 'APPROVED',
        },
      ]),
      id: vi
        .fn()
        .mockReturnValueOnce('01K4A000000000000000000010')
        .mockReturnValueOnce('01K4A000000000000000000011')
        .mockReturnValueOnce('01K4A000000000000000000012'),
      now: () => '2026-09-05T00:00:00.000Z',
    }
    const vm = createDclWflProcessDefinitionViewModel(
      {
        ownerUserId: '01K4A000000000000000000001',
        csrfToken: 'csrf-token',
        permissions: [
          '/dcl/wfl-process-definition/submit-new',
          '/dcl/wfl-process-definition/query',
          '/vou/purchase-order/query',
        ],
      },
      ports,
    )

    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    await vm.loadTrialDocuments(draft)
    draft.script = 'def process(document):\n  return {"code": "purchase-flow"}'
    draft.trialDocument = {
      entity: 'purchase-order',
      documentId: vm.trialDocuments.value[0]!.documentId,
    }
    await expect(vm.saveDraft(draft)).resolves.toBeUndefined()
    await vm.submitDraft(draft)

    expect(ports.submit).toHaveBeenCalledWith(
      'csrf-token',
      'NEW',
      expect.objectContaining({
        script: draft.script,
        trialDocument: draft.trialDocument,
      }),
    )
    expect(ports.queryDocuments).toHaveBeenCalledWith(
      'csrf-token',
      'purchase-order',
    )
    expect(ports.drafts.delete).not.toHaveBeenCalled()
    expect(vm.drafts.value[0]?.script).toBe(draft.script)
    expect(vm.error.value).toBe('试算不通过')
    ports.submit.mockResolvedValueOnce(undefined)
    await vm.submitDraft(draft)
    expect(vm.drafts.value).toHaveLength(0)
    expect(ports.query).toHaveBeenCalledOnce()
  })

  it('gates trial and runtime enablement with exact permissions while approval actions stay server-authoritative', async () => {
    const approved = {
      subjectId: '01K4A000000000000000000030',
      code: 'purchase-flow',
      submissionId: '01K4A000000000000000000031',
      versionNo: 1,
      status: 'APPROVED' as const,
      revision: '2',
      script: 'def process(document):\n  return {}',
      compiledGraph: {
        code: 'purchase-flow',
        name: '采购流程',
        rootKey: 'root',
        nodes: [],
        edges: [],
      },
      enabled: false,
      runtimeRevision: null,
      availableApprovalActions: ['unapprove'] as const,
      availableRuntimeActions: ['enable'] as const,
      canDelete: false,
    }
    const ports = {
      drafts: {
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        delete: vi.fn(),
      },
      query: vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      get: vi.fn(),
      submit: vi.fn(),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
      setEnabled: vi.fn(),
      trial: vi.fn(),
      queryDocuments: vi.fn(),
      id: vi.fn(),
      now: () => '2026-09-05T00:00:00.000Z',
    }
    const vm = createDclWflProcessDefinitionViewModel(
      {
        ownerUserId: '01K4A000000000000000000001',
        csrfToken: 'csrf-token',
        permissions: [
          '/dcl/wfl-process-definition/enable',
          '/dcl/wfl-process-definition/approve',
        ],
      },
      ports,
    )

    expect(vm.canSetEnabled(approved, true)).toBe(true)
    expect(
      vm.canSetEnabled(
        { ...approved, enabled: true, availableRuntimeActions: [] },
        true,
      ),
    ).toBe(false)
    expect(
      vm.canReview(
        {
          subjectId: approved.subjectId,
          code: approved.code,
          latestApproved: approved,
          openCandidate: null,
        },
        'approve',
      ),
    ).toBe(false)

    await vm.setEnabled(approved, true)
    await vm.setEnabled(
      { ...approved, enabled: true, availableRuntimeActions: [] },
      false,
    )

    expect(ports.setEnabled).toHaveBeenCalledTimes(1)
    expect(ports.setEnabled).toHaveBeenCalledWith('csrf-token', 'enable', {
      subjectId: approved.subjectId,
      approvalEntryId: approved.submissionId,
      expectedApprovalRevision: approved.revision,
      expectedRuntimeRevision: null,
    })
    expect(vm.canTrial.value).toBe(false)
  })

  it('uses an exact server workbench submission and refreshes after a failed server-provided action', async () => {
    const exact = {
      subjectId: 'subject-off-page',
      code: 'purchase-flow',
      submissionId: 'submission-exact',
      versionNo: 2,
      status: 'PENDING' as const,
      revision: '4',
      script: 'def process(document):\n  return {}',
      compiledGraph: {
        code: 'purchase-flow',
        name: '采购流程',
        rootKey: 'root',
        nodes: [],
        edges: [],
      },
      enabled: false,
      runtimeRevision: null,
      availableApprovalActions: ['approve'] as const,
      availableRuntimeActions: [] as const,
      canDelete: false,
    }
    const ports = {
      drafts: { list: vi.fn(), save: vi.fn(), delete: vi.fn() },
      query: vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      get: vi.fn().mockResolvedValue(exact),
      submit: vi.fn(),
      review: vi.fn().mockRejectedValue(new Error('版本冲突')),
      deleteSubmission: vi.fn(),
      setEnabled: vi.fn(),
      trial: vi.fn(),
      queryDocuments: vi.fn(),
      id: vi.fn(),
      now: () => '2026-09-05T00:00:00.000Z',
    }
    const vm = createDclWflProcessDefinitionViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: ['/dcl/wfl-process-definition/query'],
      },
      ports,
    )
    await vm.synchronizeDeepLink({
      objectId: exact.subjectId,
      submissionId: exact.submissionId,
      revision: exact.revision,
      mode: 'view',
    })

    await vm.review(
      {
        subjectId: exact.subjectId,
        code: exact.code,
        latestApproved: null,
        openCandidate: exact,
      },
      'approve',
    )

    expect(ports.review).toHaveBeenCalledOnce()
    expect(ports.query).toHaveBeenCalledOnce()
    expect(ports.get).toHaveBeenCalledTimes(2)
    expect(vm.error.value).toBe('版本冲突')
  })

  it('deletes only when the server-authoritative submission allows deletion', async () => {
    const candidate = {
      subjectId: 'subject-1',
      code: 'purchase-flow',
      submissionId: 'submission-1',
      versionNo: 2,
      status: 'REJECTED' as const,
      revision: '4',
      script: 'def process(document):\n  return {}',
      compiledGraph: {
        code: 'purchase-flow',
        name: '采购流程',
        rootKey: 'root',
        nodes: [],
        edges: [],
      },
      enabled: false,
      runtimeRevision: null,
      availableApprovalActions: [] as const,
      availableRuntimeActions: [] as const,
      canDelete: false,
    }
    const ports = {
      drafts: { list: vi.fn(), save: vi.fn(), delete: vi.fn() },
      query: vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      get: vi.fn(),
      submit: vi.fn(),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
      setEnabled: vi.fn(),
      trial: vi.fn(),
      queryDocuments: vi.fn(),
      id: vi.fn(),
      now: () => '2026-09-05T00:00:00.000Z',
    }
    const vm = createDclWflProcessDefinitionViewModel(
      {
        ownerUserId: 'owner',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/wfl-process-definition/delete',
          '/dcl/wfl-process-definition/query',
        ],
      },
      ports,
    )

    await vm.removeSubmission(candidate)
    await vm.removeSubmission({ ...candidate, canDelete: true })

    expect(ports.deleteSubmission).toHaveBeenCalledTimes(1)
    expect(ports.deleteSubmission).toHaveBeenCalledWith('csrf', {
      subjectId: candidate.subjectId,
      submissionId: candidate.submissionId,
      expectedRevision: candidate.revision,
    })
    expect(ports.query).toHaveBeenCalledTimes(1)
  })
})
