import * as api from '../api.ts'
import {
  defineVersionPage,
  type VersionSubmission,
  type VersionCurrent,
} from '../components/version-page/definition.ts'
import type { WflData } from '../components/version-page/wfl-data.ts'
function submission(
  value: Awaited<ReturnType<typeof api.wflSubmission>>,
): VersionSubmission<WflData> {
  return {
    ...value,
    entity: 'process-definition',
    snapshot: {
      script: value.script,
      compiledGraph: value.compiledGraph,
      trialDocument: null,
      trial: null,
    },
  }
}
function current(
  value: Awaited<ReturnType<typeof api.wflCurrent>>,
): VersionCurrent<WflData> {
  return {
    objectId: value.subjectId,
    code: value.code,
    name: value.name,
    enabled: value.enabled,
    sourceApprovalEntryId: value.approvalEntryId,
    data: {
      script: null,
      compiledGraph: value.compiledGraph,
      trialDocument: null,
      trial: null,
    },
  }
}
function command(
  input: import('../components/version-page/definition.ts').VersionAdapter<WflData> extends {
    submitNew: (token: string, input: infer I) => unknown
  }
    ? I
    : never,
): api.WflSubmitNewInput {
  if (
    !input.snapshot.script ||
    !input.snapshot.trialDocument ||
    !input.snapshot.trial
  )
    throw new Error('请先选择真实单据并完成编译试算。')
  return {
    subjectId: input.subjectId,
    submissionId: input.submissionId,
    idempotencyKey: input.idempotencyKey,
    expectedLatestApprovedSubmissionId:
      input.expectedLatestApprovedSubmissionId,
    expectedLatestApprovedRevision: input.expectedLatestApprovedRevision,
    script: input.snapshot.script,
    trialDocument: input.snapshot.trialDocument,
  }
}
export const processDefinitionPage =
  defineVersionPage<'wfl/process-definition'>({
    resource: 'wfl/process-definition',
    fields: [],
    adapter: {
      empty: () => ({
        script:
          'root = node(key="root", name="销售订单", entity="sale-order")\nworkflow(code="new-flow", name="新流程", root=root, edges=[])',
        compiledGraph: null,
        trialDocument: null,
        trial: null,
      }),
      clone: (snapshot) => ({ ...snapshot, trialDocument: null, trial: null }),
      validate: (snapshot) =>
        snapshot.script && snapshot.trialDocument && snapshot.trial
          ? null
          : '请先选择真实单据并完成编译试算。',
      query: async (token, input) => {
        const result = await api.wflQuery(token, input)
        return { ...result, items: result.items.map(current) }
      },
      current: async (token, id) =>
        current(await api.wflCurrent(token, { code: id })),
      submissions: async (token, input) => {
        const result = await api.wflSubmissions(token, input)
        return {
          ...result,
          items: result.items.map((item) => ({
            ...item,
            latestApproved: item.latestApproved
              ? submission(item.latestApproved)
              : null,
            openCandidate: item.openCandidate
              ? submission(item.openCandidate)
              : null,
          })),
        }
      },
      submission: async (token, input) =>
        submission(
          await api.wflSubmission(token, {
            subjectId: input.subjectId,
            approvalEntryId: input.submissionId,
          }),
        ),
      versions: async (token, id) => ({
        items: (await api.wflVersions(token, { subjectId: id })).map(
          submission,
        ),
      }),
      audit: (token, id) => api.wflAudit(token, { subjectId: id }),
      submitNew: (token, input) => api.wflSubmitNew(token, command(input)),
      submitChange: (token, input) =>
        api.wflSubmitChange(token, command(input)),
      approve: async (token, input) =>
        submission(await api.wflApprove(token, input)),
      reject: async (token, input) =>
        submission(await api.wflReject(token, input)),
      unreject: async (token, input) =>
        submission(await api.wflUnreject(token, input)),
      unapprove: async (token, input) =>
        submission(await api.wflUnapprove(token, input)),
      delete: api.wflDelete,
      setVersionEnabled: async (token, item, enabled) => {
        if (item.runtimeRevision === undefined)
          throw new Error('流程运行修订缺失，请重新读取。')
        const result = await (enabled ? api.wflEnable : api.wflDisable)(token, {
          subjectId: item.subjectId,
          approvalEntryId: item.submissionId,
          expectedApprovalRevision: item.revision,
          expectedRuntimeRevision: item.runtimeRevision,
        })
        return {
          ...item,
          enabled: result.enabled,
          runtimeRevision: result.revision,
          availableRuntimeActions: result.availableRuntimeActions,
        }
      },
    },
  })
