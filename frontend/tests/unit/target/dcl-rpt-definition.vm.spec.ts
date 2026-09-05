import { describe, expect, it, vi } from 'vitest'

import { createDclRptDefinitionViewModel } from '@/target/pages/dcl/rpt-definition/vm.ts'

describe('DCL RPT definition public view-model seam', () => {
  it('maintains structured parameters and columns and only deletes a Draft after successful submit', async () => {
    const ports = {
      drafts: {
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        delete: vi.fn(),
      },
      query: vi.fn().mockResolvedValue({ submissions: [], total: 0 }),
      get: vi.fn(),
      versions: vi.fn(),
      audit: vi.fn(),
      submit: vi.fn().mockResolvedValue({}),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
    }
    const vm = createDclRptDefinitionViewModel(
      {
        ownerUserId: '01K4A000000000000000000001',
        csrfToken: 'csrf-token',
        permissions: [
          '/dcl/rpt-definition/submit-new',
          '/dcl/rpt-definition/query',
        ],
      },
      ports,
    )

    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    vm.addParameter(draft)
    vm.addColumn(draft)
    await vm.submitDraft(draft)

    expect(draft.snapshot.parameters[0]).toMatchObject({
      key: 'parameter1',
      type: 'TEXT',
    })
    expect(ports.submit).toHaveBeenCalledOnce()
    expect(ports.drafts.delete).toHaveBeenCalledWith(
      draft.ownerUserId,
      'rpt-definition',
      draft.draftId,
    )
    expect(vm.drafts.value).toEqual([])
    expect(ports.query).toHaveBeenCalledOnce()
  })

  it('opens an exact workbench submission without relying on the current page', async () => {
    const exact = {
      subjectId: 'subject-off-page',
      code: 'RPT-0021',
      submissionId: 'submission-exact',
      versionNo: 2,
      status: 'APPROVED' as const,
      revision: '4',
      availableApprovalActions: ['unapprove'] as const,
      canDelete: false,
      snapshot: {},
    }
    const ports = {
      drafts: { list: vi.fn(), save: vi.fn(), delete: vi.fn() },
      query: vi.fn(),
      get: vi.fn().mockResolvedValue(exact),
      versions: vi.fn().mockResolvedValue([exact]),
      audit: vi.fn().mockResolvedValue([]),
      submit: vi.fn(),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
    }
    const vm = createDclRptDefinitionViewModel(
      { ownerUserId: 'user-1', csrfToken: 'csrf', permissions: [] },
      ports,
    )

    await vm.synchronizeDeepLink({
      objectId: exact.subjectId,
      submissionId: exact.submissionId,
      revision: exact.revision,
      mode: 'view',
    })

    expect(ports.query).not.toHaveBeenCalled()
    expect(vm.detail.value?.submission).toMatchObject(exact)
  })
})
