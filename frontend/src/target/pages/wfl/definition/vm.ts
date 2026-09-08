import { ref, shallowRef, watch } from 'vue'
import { ulid } from 'ulid'
import * as api from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

export const statuses = {
  PENDING: '待批准',
  APPROVED: '已批准',
  REJECTED: '已驳回',
} as const
export const actions = {
  approve: '批准',
  reject: '驳回',
  unreject: '恢复审核',
  unapprove: '反批准',
} as const
export const nodeActions = {
  OPEN_DOCUMENT: '打开单据',
  CREATE_CHILD: '创建下级',
  APPROVE_CHILD: '批准下级',
  REJECT_CHILD: '驳回下级',
  RETRY_CHILD: '重试下级',
  CANCEL_CHILD: '取消下级',
} as const
type Definition = Awaited<ReturnType<typeof api.wflSubmission>>
const errors: Record<string, string> = {
  approval_invalid_action: '没有此操作权限。',
  approval_invalid_actor: '提交人与审批人必须分离。',
  approval_stale_revision: '资料已变化，请重新读取。',
  archive_stale_facts: '正式版本已变化，请重新读取。',
  approval_open_version_exists: '已有待处理提交，请先处理。',
  approval_not_latest_approved: '只能操作最高已批准版本。',
  wfl_definition_in_use: '该版本已有流程实例引用，不能反批准。',
  wfl_compile_failed: '脚本编译失败，请检查定义。',
  wfl_trial_failed: '真实单据试算失败。',
  wfl_trial_document_not_found: '试算单据不存在。',
  wfl_definition_code_conflict: '流程代码已被其他定义使用。',
  archive_idempotency_conflict: '此提交标识已被其他内容使用。',
  validation_failed: '输入格式不正确，请检查必填项。',
  approval_invalid_transition: '当前状态不允许此操作。',
}
export function useWflDefinitionViewModel() {
  const session = useTargetSession()
  const csrf = () => {
    if (!session.csrfToken) throw new Error('Session unavailable')
    return session.csrfToken
  }
  const can = (action: string) =>
    session.apiPaths.includes(`/wfl/process-definition/${action}`)
  const canInstance = (action: string) =>
    session.apiPaths.includes(`/wfl/process-instance/${action}`)
  const document = shallowRef<Awaited<
    ReturnType<typeof api.wflNodeDocument>
  > | null>(null)
  const currentDetail = ref<Awaited<ReturnType<typeof api.wflCurrent>> | null>(
    null,
  )
  const current = ref<Awaited<ReturnType<typeof api.wflQuery>>['items']>([])
  const submissions = ref<
    Awaited<ReturnType<typeof api.wflSubmissions>>['items']
  >([])
  const versions = ref<Definition[]>([]),
    selected = ref<Definition | null>(null)
  const keyword = ref(''),
    page = ref(1),
    total = ref(0),
    tab = ref('current')
  const loading = ref(false),
    busy = ref(false),
    unknown = ref(false),
    error = ref(''),
    feedback = ref('')
  const editing = ref(false),
    script = ref(''),
    documentId = ref(''),
    documentEntity =
      ref<api.WflSubmitNewInput['trialDocument']['entity']>('sale-order')
  const trial = ref<Awaited<ReturnType<typeof api.wflTrial>> | null>(null),
    reason = ref('')
  const instances = ref<Awaited<ReturnType<typeof api.wflInstances>>['items']>(
    [],
  )
  const instance = shallowRef<Awaited<
    ReturnType<typeof api.wflInstance>
  > | null>(null)
  const audits = ref<Awaited<ReturnType<typeof api.wflAudit>>>([])
  let disposed = false,
    generation = 0,
    appliedKeyword = '',
    base: Definition | null = null
  let verifyOperation: (() => Promise<boolean>) | null = null
  let intent = {
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
  }
  function fail(e: unknown) {
    error.value =
      e instanceof api.TargetApiError
        ? (errors[e.errorKey] ?? '操作未完成，请核对输入和权限。')
        : '请求结果未确认，请先核实。'
  }
  async function read() {
    if (tab.value === 'instances') {
      await queryInstances()
      return
    }
    const action = tab.value === 'current' ? 'query' : 'submission-query'
    if (disposed || !can(action)) return
    const token = ++generation
    loading.value = true
    try {
      const input = { keyword: appliedKeyword, page: page.value, pageSize: 20 }
      if (tab.value === 'current') {
        const result = await api.wflQuery(csrf(), input)
        if (disposed || token !== generation) return
        current.value = result.items
        total.value = result.total
      } else {
        const result = await api.wflSubmissions(csrf(), input)
        if (disposed || token !== generation) return
        submissions.value = result.items
        total.value = result.total
      }
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    } finally {
      if (token === generation) loading.value = false
    }
  }
  async function switchTab(next: 'current' | 'submissions' | 'instances') {
    if (busy.value) return
    tab.value = next
    selected.value = null
    currentDetail.value = null
    instance.value = null
    await search()
  }
  function closeEditor() {
    if (busy.value) return
    editing.value = false
    script.value = ''
    trial.value = null
    documentId.value = ''
    base = null
  }
  async function search() {
    appliedKeyword = keyword.value
    page.value = 1
    await read()
  }
  async function open(subjectId: string, approvalEntryId?: string) {
    if (!can('submission-get') || disposed) return
    const token = ++generation
    try {
      const result = await api.wflSubmission(csrf(), {
        subjectId,
        approvalEntryId,
      })
      if (!disposed && token === generation) {
        selected.value = result
        versions.value = []
        audits.value = []
      }
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    }
  }
  function create(source: Definition | null = null, change = false) {
    if (
      busy.value ||
      unknown.value ||
      !can(change ? 'submit-change' : 'submit-new')
    )
      return
    base = change ? source : null
    intent = {
      subjectId: base?.subjectId ?? ulid(),
      submissionId: ulid(),
      idempotencyKey: ulid(),
    }
    script.value =
      source?.script ??
      'root = node(key="root", name="销售订单", entity="sale-order")\nworkflow(code="new-flow", name="新流程", root=root, edges=[])'
    trial.value = null
    editing.value = true
    error.value = ''
    feedback.value = ''
  }
  async function mutate<T>(
    operation: () => Promise<T>,
    after: (result: T) => void,
    verification: () => Promise<boolean>,
  ) {
    if (disposed || busy.value || unknown.value) return
    const token = generation
    busy.value = true
    error.value = ''
    feedback.value = ''
    try {
      const result = await operation()
      if (disposed || token !== generation) return
      after(result)
      feedback.value = '操作成功。'
      await read()
    } catch (e) {
      if (!disposed && token === generation) {
        fail(e)
        if (!(e instanceof api.TargetApiError)) {
          unknown.value = true
          verifyOperation = verification
        }
      }
    } finally {
      if (!disposed) busy.value = false
    }
  }
  async function readExact(
    item: Pick<Definition, 'subjectId' | 'submissionId'>,
  ) {
    if (!can('submission-get')) throw new Error('缺少提交读取权限')
    return api.wflSubmission(csrf(), {
      subjectId: item.subjectId,
      approvalEntryId: item.submissionId,
    })
  }
  async function openCurrent(code: string) {
    if (disposed || busy.value || !can('get')) return
    const token = ++generation
    try {
      const result = await api.wflCurrent(csrf(), { code })
      if (!disposed && token === generation) currentDetail.value = result
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    }
  }
  async function runTrial() {
    if (!can('trial') || busy.value || disposed) return
    const token = generation,
      source = script.value,
      trialDocumentId = documentId.value,
      trialEntity = documentEntity.value
    busy.value = true
    try {
      const result = await api.wflTrial(csrf(), {
        script: source,
        document: {
          entity: documentEntity.value,
          documentId: documentId.value,
        },
      })
      if (
        !disposed &&
        token === generation &&
        source === script.value &&
        trialDocumentId === documentId.value &&
        trialEntity === documentEntity.value
      )
        trial.value = result
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    } finally {
      busy.value = false
    }
  }
  async function submit() {
    if (!trial.value || !can(base ? 'submit-change' : 'submit-new')) return
    const input: api.WflSubmitNewInput = {
      ...intent,
      expectedLatestApprovedSubmissionId: base?.submissionId ?? null,
      expectedLatestApprovedRevision: base?.revision ?? null,
      script: script.value,
      trialDocument: {
        entity: documentEntity.value,
        documentId: documentId.value,
      },
    }
    await mutate(
      () => (base ? api.wflSubmitChange : api.wflSubmitNew)(csrf(), input),
      (result) => {
        selected.value = result
        editing.value = false
      },
      async () => {
        const result = await readExact(input)
        return result.script === input.script
      },
    )
  }
  async function verify() {
    if (!unknown.value || !verifyOperation || busy.value || disposed) return
    const token = generation
    busy.value = true
    try {
      const confirmed = await verifyOperation()
      if (disposed || token !== generation) return
      if (!confirmed) {
        error.value = '当前事实尚不能确认此次写入，请保留待核实状态。'
        return
      }
      unknown.value = false
      verifyOperation = null
      editing.value = false
      selected.value = null
      instance.value = null
      feedback.value = '已核实操作结果，请重新打开查看。'
      await read()
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    } finally {
      if (!disposed) busy.value = false
    }
  }
  async function review(action: keyof typeof actions) {
    const item = selected.value
    if (!item?.availableApprovalActions.includes(action) || !can(action)) return
    const input = {
      subjectId: item.subjectId,
      submissionId: item.submissionId,
      expectedRevision: item.revision,
      reason: reason.value,
    }
    const plain = {
      subjectId: item.subjectId,
      submissionId: item.submissionId,
      expectedRevision: item.revision,
    }
    const operations = {
      approve: () => api.wflApprove(csrf(), plain),
      reject: () => api.wflReject(csrf(), input),
      unreject: () => api.wflUnreject(csrf(), plain),
      unapprove: () => api.wflUnapprove(csrf(), input),
    }
    await mutate(
      operations[action],
      (result) => {
        selected.value = result
      },
      async () => {
        const result = await readExact(item)
        const expected = {
          approve: 'APPROVED',
          reject: 'REJECTED',
          unreject: 'PENDING',
          unapprove: 'PENDING',
        }
        return (
          result.status === expected[action] &&
          BigInt(result.revision) === BigInt(item.revision) + 1n
        )
      },
    )
  }
  async function toggle(action: 'enable' | 'disable') {
    const item = selected.value
    if (!item?.availableRuntimeActions.includes(action) || !can(action)) return
    await mutate(
      () =>
        (action === 'enable' ? api.wflEnable : api.wflDisable)(csrf(), {
          subjectId: item.subjectId,
          approvalEntryId: item.submissionId,
          expectedApprovalRevision: item.revision,
          expectedRuntimeRevision: item.runtimeRevision,
        }),
      (result) => {
        selected.value = {
          ...item,
          enabled: result.enabled,
          runtimeRevision: result.revision,
          availableRuntimeActions: result.availableRuntimeActions,
        }
      },
      async () => {
        const result = await readExact(item)
        return (
          result.enabled === (action === 'enable') &&
          BigInt(result.runtimeRevision ?? '0') ===
            BigInt(item.runtimeRevision ?? '0') + 1n
        )
      },
    )
  }
  async function remove() {
    const item = selected.value
    if (!item?.canDelete || !can('delete')) return
    await mutate(
      () =>
        api.wflDelete(csrf(), {
          subjectId: item.subjectId,
          submissionId: item.submissionId,
          expectedRevision: item.revision,
        }),
      () => {
        selected.value = null
      },
      async () => {
        try {
          await readExact(item)
          return false
        } catch (e) {
          return (
            e instanceof api.TargetApiError &&
            e.errorKey === 'approval_not_found'
          )
        }
      },
    )
  }
  async function history() {
    if (!selected.value || !can('versions')) return
    const id = selected.value.subjectId,
      token = generation
    try {
      const result = await api.wflVersions(csrf(), { subjectId: id })
      if (!disposed && token === generation) versions.value = result
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    }
  }
  async function audit() {
    if (!selected.value || !can('audit-history')) return
    const id = selected.value.subjectId,
      token = generation
    try {
      const result = await api.wflAudit(csrf(), { subjectId: id })
      if (!disposed && token === generation) audits.value = result
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    }
  }
  async function queryInstances() {
    if (!canInstance('query') || disposed) return
    const token = ++generation
    try {
      const result = await api.wflInstances(csrf(), {
        page: page.value,
        pageSize: 20,
        keyword: appliedKeyword,
      })
      if (!disposed && token === generation) {
        instances.value = result.items
        total.value = result.total
      }
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    }
  }
  async function openInstance(processId: string) {
    if (!canInstance('get') || disposed) return
    const token = ++generation
    try {
      const result = await api.wflInstance(csrf(), { processId })
      if (!disposed && token === generation) instance.value = result
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    }
  }
  async function nodeAction(
    node: NonNullable<typeof instance.value>['nodes'][number],
    action: keyof typeof nodeActions,
    targetNodeKey?: string,
  ) {
    if (!instance.value || !node.availableActions.includes(action)) return
    if (action === 'OPEN_DOCUMENT' && node.entity && node.documentId) {
      if (
        !session.apiPaths.includes(`/vou/${node.entity}/get`) ||
        busy.value ||
        unknown.value
      )
        return
      const token = generation,
        processId = instance.value.processId,
        requestKey = ulid()
      busy.value = true
      let recorded = false
      try {
        const result = await api.wflInstanceAction(csrf(), {
          processId,
          nodeId: node.nodeId,
          action,
          requestKey,
        })
        if (disposed || token !== generation) return
        instance.value = result
        recorded = true
        const detail = await api.wflNodeDocument(
          csrf(),
          node.entity,
          node.documentId,
        )
        if (!disposed && token === generation) {
          document.value = detail
          feedback.value = ''
        }
      } catch (e) {
        if (!disposed && token === generation) {
          fail(e)
          if (recorded)
            feedback.value = '打开动作已记录，单据读取失败，可重新读取。'
          else if (!(e instanceof api.TargetApiError)) {
            unknown.value = true
            verifyOperation = async () => {
              if (!canInstance('audit-history'))
                throw new Error('缺少运行审计读取权限')
              const events = await api.wflInstanceAudit(csrf(), { processId })
              return events.some(
                (event) =>
                  event.action === action &&
                  typeof event.details === 'object' &&
                  event.details !== null &&
                  (event.details as Record<string, unknown>).nodeId ===
                    node.nodeId &&
                  (event.details as Record<string, unknown>).documentId ===
                    node.documentId,
              )
            }
          }
        }
      } finally {
        if (!disposed) busy.value = false
      }
      return
    }
    const input = {
      processId: instance.value.processId,
      nodeId: node.nodeId,
      action,
      targetNodeKey,
      requestKey: ulid(),
      expectedRevision: node.revision ?? undefined,
      reason: reason.value || undefined,
    }
    await mutate(
      () => api.wflInstanceAction(csrf(), input),
      (result) => {
        instance.value = result
      },
      async () => {
        if (!canInstance('audit-history'))
          throw new Error('缺少运行审计读取权限')
        const events = await api.wflInstanceAudit(csrf(), {
          processId: input.processId,
        })
        return events.some((event) => {
          if (
            event.action !== action ||
            typeof event.details !== 'object' ||
            event.details === null
          )
            return false
          const details = event.details as Record<string, unknown>
          return (
            details.requestKey === input.requestKey &&
            details.nodeId === input.nodeId
          )
        })
      },
    )
  }
  const stop = watch(
    () => session.generation,
    () => {
      generation++
      editing.value = false
      script.value = ''
      selected.value = null
      currentDetail.value = null
      document.value = null
      current.value = []
      submissions.value = []
      instance.value = null
      instances.value = []
      versions.value = []
      audits.value = []
      trial.value = null
      reason.value = ''
      documentId.value = ''
      keyword.value = ''
      appliedKeyword = ''
      page.value = 1
      total.value = 0
      unknown.value = false
      verifyOperation = null
      error.value = ''
      feedback.value = ''
    },
    { flush: 'sync' },
  )
  const invalidateTrial = watch(
    [script, documentId, documentEntity],
    () => {
      trial.value = null
    },
    { flush: 'sync' },
  )
  function dispose() {
    disposed = true
    generation++
    stop()
    invalidateTrial()
    script.value = ''
    editing.value = false
  }
  return {
    document,
    can,
    canInstance,
    currentDetail,
    openCurrent,
    current,
    submissions,
    selected,
    versions,
    audits,
    keyword,
    page,
    total,
    tab,
    loading,
    busy,
    unknown,
    error,
    feedback,
    editing,
    script,
    documentId,
    documentEntity,
    trial,
    reason,
    instances,
    instance,
    read,
    switchTab,
    closeEditor,
    search,
    open,
    create,
    runTrial,
    submit,
    verify,
    review,
    toggle,
    remove,
    history,
    audit,
    queryInstances,
    openInstance,
    nodeAction,
    dispose,
  }
}
