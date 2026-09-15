import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decideApproval,
  modelBuildId,
  projectApprovalViewState,
  runTargetModelCorpus,
  type ApprovalEntry,
  type ApprovalActor,
} from '../src/index.ts'

test('exports a non-empty deterministic shared-model build identifier', () => {
  assert.match(modelBuildId, /^[a-z0-9][a-z0-9._-]*$/)
})

test('runs the canonical target corpus in the server runtime', () => {
  const result = runTargetModelCorpus()
  assert.deepEqual(result.pendingView.availableActions, ['reject', 'approve'])
  assert.equal(result.approve.ok, true)
  assert.deepEqual(result.stale, {
    ok: false,
    error: { errorKey: 'approval_stale_revision' },
  })
})

const submitter: ApprovalActor = {
  id: 'user-submitter',
  permissions: [],
}

const reviewer: ApprovalActor = {
  id: 'user-reviewer',
  permissions: [
    '/dcl/product/reject',
    '/dcl/product/approve',
    '/dcl/product/unreject',
    '/dcl/product/unapprove',
  ],
}

function entry(status: ApprovalEntry['status']): ApprovalEntry {
  return {
    id: 'submission-1',
    domain: 'dcl',
    entity: 'product',
    subjectId: 'warehouse-1',
    versionNo: 1,
    status,
    revision: '7',
    metadata: {
      submitted: {
        actorId: 'user-submitter',
        occurredAt: '2026-09-03T00:00:00Z',
      },
      ...(status === 'APPROVED'
        ? {
            approved: {
              actorId: 'user-reviewer',
              occurredAt: '2026-09-03T01:00:00Z',
            },
          }
        : {}),
      ...(status === 'REJECTED'
        ? {
            rejected: {
              actorId: 'user-reviewer',
              occurredAt: '2026-09-03T01:00:00Z',
              reason: '资料不完整',
            },
          }
        : {}),
    },
  }
}

test('projects the closed Approval actor and exact-permission matrix in fixed action order', () => {
  assert.deepEqual(
    projectApprovalViewState(entry('PENDING'), submitter).availableActions,
    [],
  )
  assert.deepEqual(
    projectApprovalViewState(entry('PENDING'), reviewer).availableActions,
    ['reject', 'approve'],
  )
  assert.deepEqual(
    projectApprovalViewState(entry('REJECTED'), reviewer).availableActions,
    ['unreject'],
  )
  assert.deepEqual(
    projectApprovalViewState(entry('APPROVED'), reviewer).availableActions,
    ['unapprove'],
  )
  assert.equal(
    projectApprovalViewState(entry('REJECTED'), reviewer).statusLabel,
    '已驳回',
  )
})

test('decides Approval transitions with revision, reason, separation-of-duties, and exact metadata', () => {
  const rejected = decideApproval({
    action: 'reject',
    entry: entry('PENDING'),
    actor: reviewer,
    expectedRevision: '7',
    occurredAt: '2026-09-03T02:00:00Z',
    requestId: 'request-1',
    reason: ' 资料不完整 ',
  })
  assert.deepEqual(rejected, {
    ok: true,
    plan: {
      kind: 'approval-transition',
      action: 'reject',
      entryId: 'submission-1',
      fromStatus: 'PENDING',
      toStatus: 'REJECTED',
      fromRevision: '7',
      toRevision: '8',
      actorId: 'user-reviewer',
      requestId: 'request-1',
      reason: '资料不完整',
      metadata: {
        submitted: {
          actorId: 'user-submitter',
          occurredAt: '2026-09-03T00:00:00Z',
        },
        rejected: {
          actorId: 'user-reviewer',
          occurredAt: '2026-09-03T02:00:00Z',
          reason: '资料不完整',
        },
      },
      event: {
        action: 'REJECTED',
        fromStatus: 'PENDING',
        toStatus: 'REJECTED',
        fromRevision: '7',
        toRevision: '8',
        actorId: 'user-reviewer',
        requestId: 'request-1',
        reason: '资料不完整',
      },
    },
  })
  assert.deepEqual(
    decideApproval({
      action: 'approve',
      entry: entry('PENDING'),
      actor: submitter,
      expectedRevision: '7',
      occurredAt: '2026-09-03T02:00:00Z',
      requestId: 'request-2',
    }),
    { ok: false, error: { errorKey: 'approval_self_review_forbidden' } },
  )
  assert.deepEqual(
    decideApproval({
      action: 'unapprove',
      entry: entry('APPROVED'),
      actor: reviewer,
      expectedRevision: '6',
      occurredAt: '2026-09-03T02:00:00Z',
      requestId: 'request-3',
      reason: '需要重新审核',
    }),
    { ok: false, error: { errorKey: 'approval_stale_revision' } },
  )
})

test('keeps PostgreSQL bigint revisions exact without JavaScript number coercion', () => {
  const current = entry('PENDING')
  current.revision = '9007199254740993'
  const decision = decideApproval({
    action: 'approve',
    entry: current,
    actor: reviewer,
    expectedRevision: '9007199254740993',
    occurredAt: '2026-09-03T02:00:00Z',
    requestId: 'bigint-revision',
  })
  assert.equal(decision.ok, true)
  if (decision.ok) assert.equal(decision.plan.toRevision, '9007199254740994')
})

test('covers the closed Approval action, actor, permission, and reason matrix', () => {
  const cases = [
    ['PENDING', 'reject', 'REJECTED', true],
    ['PENDING', 'approve', 'APPROVED', false],
    ['REJECTED', 'unreject', 'PENDING', false],
    ['APPROVED', 'unapprove', 'PENDING', true],
  ] as const
  for (const [status, action, nextStatus, needsReason] of cases) {
    const withoutPermission = decideApproval({
      action,
      entry: entry(status),
      actor: { id: reviewer.id, permissions: [] },
      expectedRevision: '7',
      occurredAt: '2026-09-03T02:00:00Z',
      requestId: `permission-${action}`,
      ...(needsReason ? { reason: '原因' } : {}),
    })
    assert.deepEqual(withoutPermission, {
      ok: false,
      error: { errorKey: 'approval_invalid_action' },
    })

    const decided = decideApproval({
      action,
      entry: entry(status),
      actor: reviewer,
      expectedRevision: '7',
      occurredAt: '2026-09-03T02:00:00Z',
      requestId: `success-${action}`,
      ...(needsReason ? { reason: ' 原因 ' } : {}),
    })
    assert.equal(decided.ok, true)
    if (decided.ok) {
      assert.equal(decided.plan.toStatus, nextStatus)
      assert.equal(decided.plan.toRevision, '8')
    }

    const submitterDecision = decideApproval({
      action,
      entry: entry(status),
      actor: {
        id: submitter.id,
        permissions: [`/dcl/product/${action}`],
      },
      expectedRevision: '7',
      occurredAt: '2026-09-03T02:00:00Z',
      requestId: `submitter-${action}`,
      ...(needsReason ? { reason: '原因' } : {}),
    })
    if (action === 'unapprove') {
      assert.equal(submitterDecision.ok, true)
      if (submitterDecision.ok)
        assert.equal(submitterDecision.plan.toStatus, 'PENDING')
    } else {
      assert.deepEqual(submitterDecision, {
        ok: false,
        error: { errorKey: 'approval_self_review_forbidden' },
      })
    }
  }

  for (const action of ['approve', 'unreject'] as const)
    assert.deepEqual(
      decideApproval({
        action,
        entry: entry(action === 'approve' ? 'PENDING' : 'REJECTED'),
        actor: reviewer,
        expectedRevision: '7',
        occurredAt: '2026-09-03T02:00:00Z',
        requestId: `reason-${action}`,
        reason: '不应发送',
      }),
      { ok: false, error: { errorKey: 'approval_reason_not_allowed' } },
    )

  assert.deepEqual(
    decideApproval({
      action: 'approve',
      entry: entry('PENDING'),
      actor: { ...submitter, trusted: true },
      expectedRevision: '7',
      occurredAt: '2026-09-03T02:00:00Z',
      requestId: 'trusted-self-review',
    }),
    { ok: false, error: { errorKey: 'approval_self_review_forbidden' } },
  )
})
