import { ref, shallowRef, watch } from 'vue'
import { ulid } from 'ulid'
import * as api from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { wflErrors } from '../../../components/version-page/wfl-data.ts'
export const statuses = {
  PENDING: '待批准',
  APPROVED: '已批准',
  REJECTED: '已驳回',
} as const
export const nodeActions = {
  OPEN_DOCUMENT: '打开单据',
  CREATE_CHILD: '创建下级',
  APPROVE_CHILD: '批准下级',
  REJECT_CHILD: '驳回下级',
  RETRY_CHILD: '重试下级',
  CANCEL_CHILD: '取消下级',
} as const

export function useWflInstanceViewModel() {
  const session = useTargetSession()
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const canInstance = (action: string) =>
    session.can(`/wfl/process-instance/${action}`)
  const document = shallowRef<Awaited<
    ReturnType<typeof api.wflNodeDocument>
  > | null>(null)
  const instances = ref<Awaited<ReturnType<typeof api.wflInstances>>['items']>(
    [],
  )
  const instance = shallowRef<Awaited<
    ReturnType<typeof api.wflInstance>
  > | null>(null)
  const keyword = ref(''),
    page = ref(1),
    total = ref(0),
    loading = ref(false),
    busy = ref(false),
    unknown = ref(false),
    error = ref(''),
    feedback = ref(''),
    reason = ref('')
  let disposed = false,
    generation = 0,
    appliedKeyword = ''
  let verifyOperation: (() => Promise<boolean>) | null = null
  function fail(cause: unknown) {
    error.value =
      cause instanceof api.TargetApiError
        ? (wflErrors[cause.errorKey] ?? '操作未完成，请核对输入和权限。')
        : '请求结果未确认，请先核实。'
  }
  async function read() {
    loading.value = true
    try {
      await queryInstances()
    } finally {
      if (!disposed) loading.value = false
    }
  }
  async function search() {
    appliedKeyword = keyword.value
    page.value = 1
    await read()
  }
  async function mutate<T>(
    operation: () => Promise<T>,
    after: (result: T) => void,
    verification: () => Promise<boolean>,
  ) {
    if (disposed || busy.value || unknown.value) return
    const token = generation
    const sessionGeneration = session.generation
    const ownsWrite = () =>
      !disposed && sessionGeneration === session.generation
    busy.value = true
    error.value = ''
    feedback.value = ''
    try {
      const result = await operation()
      if (!ownsWrite()) return
      if (token === generation) after(result)
      feedback.value = '操作成功。'
      await read()
    } catch (e) {
      if (ownsWrite()) {
        fail(e)
        if (!(e instanceof api.TargetApiError)) {
          unknown.value = true
          verifyOperation = verification
        }
      }
    } finally {
      if (ownsWrite()) busy.value = false
    }
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
      instance.value = null
      feedback.value = '已核实操作结果，请重新打开查看。'
      await read()
    } catch (e) {
      if (!disposed && token === generation) fail(e)
    } finally {
      if (!disposed) busy.value = false
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
      const sessionGeneration = session.generation
      const ownsWrite = () =>
        !disposed && sessionGeneration === session.generation
      busy.value = true
      let recorded = false
      try {
        const result = await api.wflInstanceAction(csrf(), {
          processId,
          nodeId: node.nodeId,
          action,
          requestKey,
        })
        if (!ownsWrite()) return
        recorded = true
        if (token !== generation) {
          feedback.value = '打开动作已记录，请重新打开单据查看。'
          return
        }
        instance.value = result
        const detail = await api.wflNodeDocument(
          csrf(),
          node.entity,
          node.documentId,
        )
        if (ownsWrite() && token === generation) {
          document.value = detail
          feedback.value = ''
        }
      } catch (e) {
        if (ownsWrite()) {
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
        if (ownsWrite()) busy.value = false
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
      busy.value = false
      document.value = null
      instances.value = []
      instance.value = null
      keyword.value = ''
      appliedKeyword = ''
      page.value = 1
      total.value = 0
      unknown.value = false
      verifyOperation = null
      reason.value = ''
      error.value = ''
      feedback.value = ''
    },
    { flush: 'sync' },
  )
  function dispose() {
    disposed = true
    generation++
    stop()
    document.value = null
    instance.value = null
  }
  return {
    document,
    canInstance,
    instances,
    instance,
    keyword,
    page,
    total,
    loading,
    busy,
    unknown,
    error,
    feedback,
    reason,
    read,
    search,
    openInstance,
    nodeAction,
    verify,
    dispose,
  }
}
