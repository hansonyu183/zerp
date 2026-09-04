import { describe, expect, it } from 'vitest'

import {
  archiveValidityPresentation,
  latestApproved,
  isLatestSubmission,
  parseArchiveQueryPage,
  parseArchiveSubmissionPage,
} from '../../../src/target/archive-view.ts'

describe('archive submission view parser', () => {
  it('keeps only common server-owned view fields and derives the displayed approved version', () => {
    const submissions = parseArchiveSubmissionPage('operating-entity', {
      items: [
        submission({
          submissionId: 'pending',
          versionNo: 3,
          status: 'PENDING',
        }),
        submission({
          submissionId: 'approved-1',
          versionNo: 1,
          status: 'APPROVED',
        }),
        submission({
          submissionId: 'approved-2',
          versionNo: 2,
          status: 'APPROVED',
        }),
        { submissionId: 'invalid' },
      ],
    })

    expect(submissions).toHaveLength(3)
    expect(latestApproved(submissions)).toMatchObject({
      submissionId: 'approved-2',
      versionNo: 2,
    })
    expect(submissions[0]?.availableApprovalActions).toEqual(['approve'])
  })

  it('preserves report technical validity and presents it in Chinese', () => {
    const [report] = parseArchiveSubmissionPage('rpt-definition', {
      items: [
        submission({
          validity: {
            status: 'INVALID',
            diagnostic: '结果列与查询输出不一致。',
          },
        }),
      ],
    })

    expect(report?.validity).toEqual({
      status: 'INVALID',
      diagnostic: '结果列与查询输出不一致。',
    })
    expect(archiveValidityPresentation(report!.validity!).label).toBe(
      '技术失效',
    )
  })

  it('flattens each query summary without combining approved and open snapshots', () => {
    const page = parseArchiveQueryPage('operating-entity', {
      items: [
        {
          subjectId: 'subject-1',
          code: 'OPE-000001',
          latestApproved: submission({
            submissionId: 'approved-1',
            status: 'APPROVED',
          }),
          openCandidate: submission({
            submissionId: 'pending-2',
            versionNo: 2,
            status: 'PENDING',
          }),
        },
      ],
      total: 1,
    })

    expect(page.total).toBe(1)
    expect(page.submissions.map((item) => item.submissionId)).toEqual([
      'approved-1',
      'pending-2',
    ])
    expect(page.submissions[0]).not.toHaveProperty('snapshot')
    expect(page.submissions[1]).not.toHaveProperty('snapshot')
    expect(isLatestSubmission(page.submissions[0]!, page.submissions)).toBe(
      false,
    )
    expect(isLatestSubmission(page.submissions[1]!, page.submissions)).toBe(
      true,
    )
  })
})

function submission(overrides: Record<string, unknown>) {
  return {
    subjectId: 'subject-1',
    code: 'OPE-000001',
    submissionId: 'submission-1',
    versionNo: 1,
    status: 'APPROVED',
    revision: '1',
    snapshot: { legalName: '主体' },
    availableApprovalActions: ['approve'],
    canDelete: false,
    ...overrides,
  }
}
