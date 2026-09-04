import assert from 'node:assert/strict'
import test from 'node:test'

import {
  prepareVouApproval,
  prepareVouSubmission,
  systemGeneratedVouEntities,
  userCreatableVouEntities,
  vouEntities,
  type ApprovalActor,
  type ApprovalEntry,
} from '../src/index.ts'

const submitter: ApprovalActor = {
  id: '01J00000000000000000000001',
  permissions: userCreatableVouEntities.flatMap((entity) => [
    `/vou/${entity}/submit-new`,
    `/vou/${entity}/submit-change`,
  ]),
}

const reviewer: ApprovalActor = {
  id: '01J00000000000000000000002',
  permissions: vouEntities.flatMap((entity) => [
    `/vou/${entity}/approve`,
    `/vou/${entity}/unapprove`,
    `/vou/${entity}/reject`,
    `/vou/${entity}/unreject`,
  ]),
}

test('every browser-creatable VOU produces one immutable submission plan', () => {
  assert.equal(vouEntities.length, 36)
  assert.equal(userCreatableVouEntities.length, 32)
  assert.deepEqual(systemGeneratedVouEntities, [
    'sale-outbound',
    'sale-delivery',
    'sale-signoff',
    'expense-payment',
  ])

  for (const [index, entity] of userCreatableVouEntities.entries()) {
    const result = prepareVouSubmission(
      {
        action: 'submit-new',
        entity,
        documentId: `01J00000000000000000${String(index).padStart(3, '0')}`,
        submissionId: `01J10000000000000000${String(index).padStart(3, '0')}`,
        idempotencyKey: `01J10000000000000000${String(index).padStart(3, '0')}`,
        expectedRevision: null,
        payload: {
          businessDate: '2026-09-04',
          currency: 'CNY',
          amount: '10.00',
          lines: [],
          attachments: [],
        },
      },
      {
        actor: submitter,
        documentExists: false,
        currentSubmissionId: null,
        currentRevision: null,
        referencesValid: true,
        periodOpen: true,
        trustedSystemActor: false,
      },
    )
    assert.equal(result.ok, true, entity)
    if (!result.ok) continue
    assert.equal(result.plan.entity, entity)
    assert.equal(result.plan.status, 'PENDING')
    assert.equal(result.plan.payload.businessDate, '2026-09-04')
  }
})

test('system-generated VOU requires the trusted actor and never masquerades as a browser Draft', () => {
  const command = {
    action: 'submit-new' as const,
    entity: 'sale-outbound' as const,
    documentId: '01J00000000000000000000011',
    submissionId: '01J10000000000000000000011',
    idempotencyKey: '01J10000000000000000000011',
    expectedRevision: null,
    payload: {
      businessDate: '2026-09-04',
      currency: 'CNY',
      amount: '10.00',
      lines: [],
      attachments: [],
    },
  }
  const facts = {
    actor: submitter,
    documentExists: false,
    currentSubmissionId: null,
    currentRevision: null,
    referencesValid: true,
    periodOpen: true,
    trustedSystemActor: false,
  }

  assert.deepEqual(prepareVouSubmission(command, facts), {
    ok: false,
    errorKey: 'vou_trusted_actor_required',
  })
  const result = prepareVouSubmission(command, {
    ...facts,
    trustedSystemActor: true,
  })
  assert.equal(result.ok, true)
})

test('approve and unapprove return typed effects without duplicating Approval facts', () => {
  const pending: ApprovalEntry = {
    id: '01J10000000000000000000021',
    domain: 'vou',
    entity: 'purchase-inbound',
    subjectId: '01J00000000000000000000021',
    versionNo: null,
    status: 'PENDING',
    revision: '1',
    metadata: {
      submitted: {
        actorId: submitter.id,
        occurredAt: '2026-09-04T00:00:00.000Z',
      },
    },
  }
  const approved = prepareVouApproval(
    'approve',
    pending,
    reviewer,
    {
      irreversibleBlockers: [],
      accounting: { kind: 'POST', bookIds: ['book-1'] },
      inventory: { kind: 'INBOUND', lineCount: 2 },
      workflow: { kind: 'START_OR_CONTINUE' },
    },
    undefined,
    {
      occurredAt: '2026-09-04T01:00:00.000Z',
      requestId: 'vou-approve',
    },
  )
  assert.equal(approved.ok, true)
  if (!approved.ok) return
  assert.deepEqual(approved.plan.effects.map((effect) => effect.domain), [
    'acc',
    'inventory',
    'wfl',
  ])
  assert.equal('status' in approved.plan.effects[0]!, false)

  const blocked = prepareVouApproval(
    'unapprove',
    { ...pending, status: 'APPROVED', revision: '2' },
    reviewer,
    {
      irreversibleBlockers: [
        { kind: 'DOWNSTREAM_DOCUMENT', id: '01J30000000000000000000021' },
      ],
      accounting: { kind: 'REVERSE', bookIds: ['book-1'] },
      inventory: { kind: 'REVERSE', lineCount: 2 },
      workflow: { kind: 'REVERSE' },
    },
    'reverse',
    {
      occurredAt: '2026-09-04T02:00:00.000Z',
      requestId: 'vou-unapprove',
    },
  )
  assert.deepEqual(blocked, {
    ok: false,
    errorKey: 'vou_unapprove_blocked',
    blockers: [
      { kind: 'DOWNSTREAM_DOCUMENT', id: '01J30000000000000000000021' },
    ],
  })
})
