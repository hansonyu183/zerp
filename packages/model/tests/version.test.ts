import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decideApproval,
  modelBuildId,
  projectApprovalViewState,
  prepareWarehouseSubmit,
  runTargetModelCorpus,
  type ApprovalEntry,
  type ApprovalActor,
  type WarehouseSubmitCommand,
  type WarehouseSubmitFacts,
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
    '/dcl/warehouse/reject',
    '/dcl/warehouse/approve',
    '/dcl/warehouse/unreject',
    '/dcl/warehouse/unapprove',
  ],
}

function entry(status: ApprovalEntry['status']): ApprovalEntry {
  return {
    id: 'submission-1',
    domain: 'dcl',
    entity: 'warehouse',
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
        permissions: [`/dcl/warehouse/${action}`],
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

function warehouseCommand(
  action: 'submit-new' | 'submit-change',
): WarehouseSubmitCommand {
  return {
    action,
    actor: {
      id: 'user-submitter',
      permissions: [`/dcl/warehouse/${action}`],
    },
    requestId: 'request-submit',
    occurredAt: '2026-09-03T03:00:00Z',
    submissionId: 'submission-warehouse-1',
    idempotencyKey: 'submission-warehouse-1',
    subjectId: 'warehouse-1',
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    data: {
      name: ' 主仓 ',
      address: ' 上海 ',
      contactName: ' 张三 ',
      contactPhone: ' 13800000000 ',
      manager: {
        employeeId: 'employee-1',
        approvalEntryId: 'employee-entry-1',
        code: 'CLIENT-CODE',
        displayName: '客户端负责人',
      },
      remark: ' 备注 ',
      enabled: true,
    },
  }
}

function newWarehouseFacts(): WarehouseSubmitFacts {
  return {
    subject: { exists: false, history: [] },
    manager: {
      employeeId: 'employee-1',
      latestApprovedEntryId: 'employee-entry-1',
      code: 'EMP-0001',
      displayName: ' 仓库负责人 ',
      enabled: true,
    },
  }
}

test('prepares a normalized Warehouse submit-new plan from explicit current facts', () => {
  assert.deepEqual(
    prepareWarehouseSubmit(warehouseCommand('submit-new'), newWarehouseFacts()),
    {
      ok: true,
      plan: {
        kind: 'warehouse-submit',
        mode: 'new',
        createSubject: true,
        allocateCode: true,
        subjectId: 'warehouse-1',
        submissionId: 'submission-warehouse-1',
        idempotencyKey: 'submission-warehouse-1',
        versionNo: 1,
        approval: {
          status: 'PENDING',
          revision: '1',
          submitted: {
            actorId: 'user-submitter',
            occurredAt: '2026-09-03T03:00:00Z',
          },
          event: {
            action: 'SUBMITTED',
            actorId: 'user-submitter',
            requestId: 'request-submit',
            toStatus: 'PENDING',
            toRevision: '1',
          },
        },
        data: {
          name: '主仓',
          address: '上海',
          contactName: '张三',
          contactPhone: '13800000000',
          manager: {
            employeeId: 'employee-1',
            approvalEntryId: 'employee-entry-1',
            code: 'EMP-0001',
            displayName: '仓库负责人',
          },
          remark: '备注',
          enabled: true,
        },
      },
    },
  )
})

test('rejects mismatched Warehouse mode, history/open candidates, and stale manager references', () => {
  assert.deepEqual(
    prepareWarehouseSubmit(
      warehouseCommand('submit-change'),
      newWarehouseFacts(),
    ),
    { ok: false, error: { errorKey: 'warehouse_submit_mode_mismatch' } },
  )
  assert.deepEqual(
    prepareWarehouseSubmit(warehouseCommand('submit-new'), {
      ...newWarehouseFacts(),
      subject: {
        exists: true,
        history: [
          {
            entryId: 'approved-1',
            versionNo: 1,
            revision: '1',
            status: 'APPROVED',
          },
        ],
      },
    }),
    { ok: false, error: { errorKey: 'warehouse_submit_mode_mismatch' } },
  )
  assert.deepEqual(
    prepareWarehouseSubmit(warehouseCommand('submit-change'), {
      ...newWarehouseFacts(),
      subject: {
        exists: true,
        history: [
          {
            entryId: 'approved-1',
            versionNo: 1,
            revision: '1',
            status: 'APPROVED',
          },
          {
            entryId: 'open-2',
            versionNo: 2,
            revision: '1',
            status: 'PENDING',
          },
        ],
      },
    }),
    { ok: false, error: { errorKey: 'approval_open_version_exists' } },
  )
  assert.deepEqual(
    prepareWarehouseSubmit(warehouseCommand('submit-new'), {
      ...newWarehouseFacts(),
      manager: {
        employeeId: 'employee-1',
        latestApprovedEntryId: 'employee-entry-2',
        code: 'EMP-0001',
        displayName: '仓库负责人',
        enabled: true,
      },
    }),
    {
      ok: false,
      error: {
        errorKey: 'warehouse_reference_stale',
        blockers: [
          {
            field: 'manager',
            objectId: 'employee-1',
            expectedApprovalEntryId: 'employee-entry-1',
            currentApprovalEntryId: 'employee-entry-2',
          },
        ],
      },
    },
  )
})

test('rejects Warehouse submits whose expected latest approved snapshot is stale', () => {
  const command = warehouseCommand('submit-change')
  command.expectedLatestApprovedSubmissionId = 'approved-1'
  command.expectedLatestApprovedRevision = '4'
  const facts: WarehouseSubmitFacts = {
    ...newWarehouseFacts(),
    subject: {
      exists: true,
      history: [
        {
          entryId: 'approved-1',
          versionNo: 1,
          revision: '5',
          status: 'APPROVED',
        },
      ],
    },
  }
  assert.deepEqual(prepareWarehouseSubmit(command, facts), {
    ok: false,
    error: { errorKey: 'warehouse_stale_facts' },
  })
  const newCommand = warehouseCommand('submit-new')
  newCommand.expectedLatestApprovedSubmissionId = 'approved-1'
  newCommand.expectedLatestApprovedRevision = '1'
  assert.deepEqual(prepareWarehouseSubmit(newCommand, newWarehouseFacts()), {
    ok: false,
    error: { errorKey: 'warehouse_stale_facts' },
  })
})

test('rejects Warehouse data that exceeds canonical field limits', () => {
  const mismatchedIdempotency = warehouseCommand('submit-new')
  mismatchedIdempotency.idempotencyKey = 'different-submission'
  assert.deepEqual(
    prepareWarehouseSubmit(mismatchedIdempotency, newWarehouseFacts()),
    { ok: false, error: { errorKey: 'warehouse_invalid_data' } },
  )
  const oversizedFields = [
    ['name', '仓'.repeat(201)],
    ['address', '地'.repeat(501)],
    ['contactName', '联'.repeat(101)],
    ['contactPhone', '1'.repeat(33)],
    ['remark', '备'.repeat(1001)],
  ] as const
  for (const [field, value] of oversizedFields) {
    const command = warehouseCommand('submit-new')
    command.data = { ...command.data, [field]: value }
    assert.deepEqual(prepareWarehouseSubmit(command, newWarehouseFacts()), {
      ok: false,
      error: { errorKey: 'warehouse_invalid_data' },
    })
  }
})
