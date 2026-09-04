import {
  decideApproval,
  projectApprovalViewState,
  type ApprovalActor,
  type ApprovalEntry,
} from './approval.ts'
import { prepareFundAccountSubmit } from './archives.ts'

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
    fundAccountSubmit: prepareFundAccountSubmit(
      {
        action: 'submit-new',
        actor: {
          id: '01JMODELSUBMITTER0000000000',
          permissions: ['/dcl/fund-account/submit-new'],
        },
        requestId: 'model-corpus-fund-account',
        occurredAt: '2026-09-04T00:00:00.000Z',
        submissionId: '01JMODELFUNDACCOUNT00000000',
        idempotencyKey: '01JMODELFUNDACCOUNT00000000',
        subjectId: '01JMODELFUNDSUBJECT000000000',
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        data: {
          name: ' 基本户 ',
          currency: ' cny ',
          accountName: ' ZERP ',
          bank: ' 示例银行 ',
          branch: ' 示例支行 ',
          accountNumber: ' cn-12 34 ',
          remark: ' ',
          enabled: true,
          operatingEntity: {
            objectId: '01JMODELOPERATINGENTITY00000',
            approvalEntryId: '01JMODELOPERATINGENTRY000000',
            code: 'OE-0001',
            name: ' 示例主体 ',
          },
        },
      },
      {
        subject: { exists: false, history: [] },
        operatingEntity: {
          objectId: '01JMODELOPERATINGENTITY00000',
          latestApprovedEntryId: '01JMODELOPERATINGENTRY000000',
          enabled: true,
        },
      },
    ),
  }
}
