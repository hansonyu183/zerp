import { computed, reactive, ref } from 'vue'
import {
  createTargetMeasurementUnit,
  getTargetMeasurementUnit,
  queryTargetMeasurementUnits,
  saveTargetMeasurementUnit,
  setTargetMeasurementUnitEnabled,
  TargetApiError,
} from '../../../api.ts'
import {
  ListActionRefreshRequiredError,
  ListActionUnresolvedError,
  useListPageViewModel,
  type ListAction,
  type ListSearchInput,
} from '../../../components/list-page/vm.ts'
import {
  measurementUnitListPage,
  type MeasurementUnitFilters,
} from '../../../navigation/list-pages.ts'
import { useTargetSession } from '../../../session/vm.ts'
type MeasurementUnitDetail = Awaited<
  ReturnType<typeof getTargetMeasurementUnit>
>
export type MeasurementUnitListItem = Awaited<
  ReturnType<typeof queryTargetMeasurementUnits>
>['items'][number]
export const measurementUnitPaths = {
  query: '/aux/measurement-unit/query',
  get: '/aux/measurement-unit/get',
  create: '/aux/measurement-unit/create',
  save: '/aux/measurement-unit/save',
  enable: '/aux/measurement-unit/enable',
  disable: '/aux/measurement-unit/disable',
} as const

type EditorCompletion = {
  resolve: (result: 'changed' | void) => void
  reject: (cause: unknown) => void
}

const auxErrorMessages: Readonly<Record<string, string>> = {
  validation_failed: '输入内容不符合要求，请检查后重试。',
  forbidden: '当前账号没有执行此操作的权限。',
  unauthenticated: '会话已失效，请重新登录。',
  conflict: '当前辅助资料状态已变化，请刷新列表后重试。',
  not_found: '辅助资料不存在或已删除。',
  internal_error: '辅助资料服务暂时不可用，请稍后重试。',
}

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof TargetApiError)
    return auxErrorMessages[cause.errorKey] ?? cause.message ?? fallback
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function isRevisionConflict(cause: unknown): boolean {
  return cause instanceof TargetApiError && cause.errorKey === 'conflict'
}

export function useMeasurementUnitManagementViewModel() {
  const session = useTargetSession()
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorLoading = ref(false)
  const saving = ref(false)
  const editorWriteBlocked = ref(false)
  const editorError = ref<string | null>(null)
  const detail = ref<MeasurementUnitDetail | null>(null)
  const lastCreatedId = ref<string | null>(null)
  const editor = reactive({
    id: '',
    name: '',
    revision: '',
    symbol: '',
    quantityScale: 0,
  })
  let editorRequest = 0
  let editorCompletion: EditorCompletion | null = null
  let disposed = false

  function can(path: string): boolean {
    return session.can(path)
  }

  function csrf(): string {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }

  function csrfFor(generation: number, path: string): string | null {
    if (
      disposed ||
      session.generation !== generation ||
      !can(path) ||
      !session.csrfToken
    )
      return null
    return session.csrfToken
  }

  const canSave = computed(() => {
    if (editorLoading.value || editorWriteBlocked.value) return false
    if (editorMode.value === 'create') return can(measurementUnitPaths.create)
    return Boolean(
      detail.value?.availableActions.includes('edit') &&
      can(measurementUnitPaths.get) &&
      can(measurementUnitPaths.save),
    )
  })

  function clearEditorFields(): void {
    Object.assign(editor, {
      id: '',
      name: '',
      revision: '',
      symbol: '',
      quantityScale: 0,
    })
    detail.value = null
    editorError.value = null
    editorLoading.value = false
    saving.value = false
    editorWriteBlocked.value = false
  }

  function beginEditor(mode: 'create' | 'edit') {
    editorCompletion?.resolve()
    editorRequest += 1
    clearEditorFields()
    if (mode === 'create') lastCreatedId.value = null
    editorMode.value = mode
    editorOpen.value = true
    const promise = new Promise<'changed' | void>((resolve, reject) => {
      editorCompletion = { resolve, reject }
    })
    return { request: editorRequest, generation: session.generation, promise }
  }

  function finishEditor(result: 'changed' | void): void {
    const completion = editorCompletion
    editorCompletion = null
    editorRequest += 1
    editorOpen.value = false
    clearEditorFields()
    completion?.resolve(result)
  }

  function failEditorUnresolved(message: string): void {
    const completion = editorCompletion
    editorCompletion = null
    editorWriteBlocked.value = true
    editorError.value = message
    completion?.reject(new ListActionUnresolvedError(message))
  }

  function isEditorCurrent(opening: { request: number; generation: number }) {
    return (
      !disposed &&
      opening.request === editorRequest &&
      opening.generation === session.generation
    )
  }

  function openCreate(): Promise<'changed' | void> {
    const opening = beginEditor('create')
    if (!can(measurementUnitPaths.create))
      editorError.value = '缺少新增计量单位权限。'
    return opening.promise
  }

  function openEdit(item: MeasurementUnitListItem): Promise<'changed' | void> {
    const opening = beginEditor('edit')
    if (!can(measurementUnitPaths.get) || !can(measurementUnitPaths.save)) {
      editorError.value = '编辑计量单位需要详情和保存权限。'
      return opening.promise
    }
    const token = csrfFor(opening.generation, measurementUnitPaths.get)
    if (!token) {
      editorError.value = '会话已失效，无法加载编辑信息。'
      return opening.promise
    }
    editorLoading.value = true
    void getTargetMeasurementUnit(token, item.id)
      .then((current) => {
        if (!isEditorCurrent(opening)) return
        detail.value = current
        Object.assign(editor, {
          id: current.id,
          name: current.name,
          revision: current.revision,
          symbol: current.symbol,
          quantityScale: current.quantityScale,
        })
      })
      .catch((cause) => {
        if (!isEditorCurrent(opening)) return
        editorError.value = messageOf(cause, '计量单位编辑信息加载失败。')
      })
      .finally(() => {
        if (isEditorCurrent(opening)) editorLoading.value = false
      })
    return opening.promise
  }

  function validateEditor(): string | null {
    if (!editor.name.trim()) return '请输入名称。'
    if (
      !editor.symbol.trim() ||
      !Number.isInteger(editor.quantityScale) ||
      editor.quantityScale < 0 ||
      editor.quantityScale > 6
    )
      return '请输入有效的符号和数量精度（0–6）。'
    return null
  }

  async function saveEditor(): Promise<void> {
    if (!editorCompletion || saving.value || !canSave.value) return
    const validation = validateEditor()
    if (validation) {
      editorError.value = validation
      return
    }
    const request = editorRequest
    const generation = session.generation
    const token = csrf()
    saving.value = true
    editorError.value = null
    try {
      const input = {
        name: editor.name.trim(),
        symbol: editor.symbol.trim(),
        quantityScale: editor.quantityScale,
      }
      if (editorMode.value === 'create') {
        const created = await createTargetMeasurementUnit(token, input)
        if (
          disposed ||
          request !== editorRequest ||
          generation !== session.generation
        )
          return
        lastCreatedId.value = created.id
      } else
        await saveTargetMeasurementUnit(token, {
          id: editor.id,
          revision: editor.revision,
          ...input,
        })
      if (
        !disposed &&
        request === editorRequest &&
        generation === session.generation
      )
        finishEditor('changed')
    } catch (cause) {
      if (
        disposed ||
        request !== editorRequest ||
        generation !== session.generation
      )
        return
      if (isRevisionConflict(cause)) {
        editorError.value = messageOf(cause, '数据已变化，请刷新后重试。')
        editorWriteBlocked.value = true
        return
      }
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      ) {
        editorError.value = messageOf(cause, '计量单位保存失败。')
        return
      }
      failEditorUnresolved('请求结果未知；已停止再次提交，请刷新后核实。')
    } finally {
      if (
        !disposed &&
        request === editorRequest &&
        generation === session.generation
      )
        saving.value = false
    }
  }

  function closeEditor(): void {
    if (saving.value) return
    finishEditor()
  }

  function canListAction(
    item: MeasurementUnitListItem | null,
    action: ListAction,
  ): boolean {
    if (action === 'create') return can(measurementUnitPaths.create)
    if (!item) return false
    if (action === 'edit')
      return (
        item.availableActions.includes('edit') &&
        can(measurementUnitPaths.get) &&
        can(measurementUnitPaths.save)
      )
    if (action === 'enable')
      return (
        item.availableActions.includes('enable') &&
        can(measurementUnitPaths.enable)
      )
    return (
      item.availableActions.includes('disable') &&
      can(measurementUnitPaths.disable)
    )
  }

  async function setEnabled(
    item: MeasurementUnitListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    const token = csrf()
    try {
      await setTargetMeasurementUnitEnabled(
        token,
        { id: item.id, revision: item.revision },
        enabled,
      )
      return 'changed'
    } catch (cause) {
      if (disposed || generation !== session.generation) throw cause
      if (isRevisionConflict(cause))
        throw new ListActionRefreshRequiredError(
          messageOf(cause, '数据已变化，请刷新列表后重试。'),
        )
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        throw new Error(
          messageOf(
            cause,
            enabled ? '计量单位启用失败。' : '计量单位停用失败。',
          ),
        )
      try {
        const readToken = csrfFor(generation, measurementUnitPaths.get)
        if (readToken) await getTargetMeasurementUnit(readToken, item.id)
      } catch {
        // A read can inform the operator but cannot prove this write.
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新后核实。',
      )
    }
  }

  const list = useListPageViewModel<
    MeasurementUnitListItem,
    MeasurementUnitFilters
  >(
    {
      ...(can(measurementUnitPaths.query)
        ? {
            onSearch: (input: ListSearchInput<MeasurementUnitFilters>) =>
              queryTargetMeasurementUnits(csrf(), {
                ...input,
                quantityScale: input.quantityScale ?? undefined,
              }),
          }
        : {}),
      ...(can(measurementUnitPaths.create) ? { onCreate: openCreate } : {}),
      ...(can(measurementUnitPaths.get) && can(measurementUnitPaths.save)
        ? { onEdit: openEdit }
        : {}),
      ...(can(measurementUnitPaths.enable)
        ? {
            onEnable: (item: MeasurementUnitListItem) => setEnabled(item, true),
          }
        : {}),
      ...(can(measurementUnitPaths.disable)
        ? {
            onDisable: (item: MeasurementUnitListItem) =>
              setEnabled(item, false),
          }
        : {}),
      onCanAction: canListAction,
    },
    {
      initialFilters: () => ({ keyword: '', quantityScale: null }),
      validateFilters: measurementUnitListPage.normalizeFilters,
    },
  )

  const creationNotice = computed(() =>
    list.actionBlocked.value && lastCreatedId.value
      ? `新建成功（ID：${lastCreatedId.value}），但列表刷新失败，请先查询核实。`
      : '',
  )

  function dispose(): void {
    if (disposed) return
    disposed = true
    list.dispose()
    finishEditor()
  }

  return {
    list,
    editorOpen,
    editorMode,
    editorLoading,
    saving,
    editorError,
    detail,
    lastCreatedId,
    creationNotice,
    canSave,
    editor,
    openCreate,
    openEdit,
    saveEditor,
    closeEditor,
    dispose,
  }
}
