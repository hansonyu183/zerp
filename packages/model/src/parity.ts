import {
  decideApproval,
  projectApprovalViewState,
  type ApprovalActor,
  type ApprovalEntry,
} from './approval.ts'

const corpusEntry: ApprovalEntry = {
  id: '01JMODELENTRY00000000000000',
  domain: 'dcl',
  entity: 'warehouse',
  subjectId: '01JMODELSUBJECT000000000000',
  versionNo: 1,
  status: 'PENDING',
  revision: '3',
  metadata: {
    submitted: {
      actorId: '01JMODELSUBMITTER0000000000',
      occurredAt: '2026-09-03T00:00:00.000Z',
    },
  },
}

const corpusReviewer: ApprovalActor = {
  id: '01JMODELREVIEWER00000000000',
  permissions: [
    '/dcl/warehouse/reject',
    '/dcl/warehouse/approve',
    '/dcl/warehouse/unreject',
    '/dcl/warehouse/unapprove',
  ],
}

// Canonical deterministic vectors executed unchanged in Node and the browser.
export function runTargetModelCorpus() {
  return {
    pendingView: projectApprovalViewState(corpusEntry, corpusReviewer),
    approve: decideApproval({
      action: 'approve',
      entry: corpusEntry,
      actor: corpusReviewer,
      expectedRevision: '3',
      occurredAt: '2026-09-03T01:00:00.000Z',
      requestId: 'model-corpus-request',
    }),
    stale: decideApproval({
      action: 'approve',
      entry: corpusEntry,
      actor: corpusReviewer,
      expectedRevision: '2',
      occurredAt: '2026-09-03T01:00:00.000Z',
      requestId: 'model-corpus-request',
    }),
  }
}
