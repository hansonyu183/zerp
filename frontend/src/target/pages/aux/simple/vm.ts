import { computed, reactive, ref } from 'vue'

import {
  createTargetEmployeeCategory,
  createTargetPosition,
  getTargetEmployeeCategory,
  getTargetPosition,
  queryTargetEmployeeCategories,
  queryTargetPositions,
  saveTargetEmployeeCategory,
  saveTargetPosition,
  setTargetEmployeeCategoryEnabled,
  setTargetPositionEnabled,
  TargetApiError,
} from '../../../api.ts'
import {
  ListActionRefreshRequiredError,
  ListActionUnresolvedError,
  useListPageViewModel,
  type EnabledListItem,
  type ListAction,
  type ListSearchInput,
} from '../../../components/list-page/vm.ts'
import { useTargetSession } from '../../../session/vm.ts'

export type SimpleAuxListItem = EnabledListItem & {
  revision: string
  availableActions: readonly ('edit' | 'enable' | 'disable' | 'delete')[]
}

type SimpleAuxDetail = SimpleAuxListItem & {
  description?: string
}
type SimpleAuxPage<Item extends SimpleAuxListItem> = {
  items: readonly Item[]
  total: number
  page: number
  pageSize: number
}
type SimpleAuxMutationInput = {
  id: string
  name: string
  description: string
  revision: string
}
type SimpleAuxMutationResult = {
  id: string
  revision: string
  enabled: boolean
}
type SimpleAuxOperations<
  Item extends SimpleAuxListItem,
  Detail extends SimpleAuxDetail,
> = {
  title: string
  createLabel: string
  paths: {
    query: string
    get: string
    create: string
    save: string
    enable: string
    disable: string
  }
  query: (
    csrfToken: string,
    input: ListSearchInput,
  ) => Promise<SimpleAuxPage<Item>>
  get: (csrfToken: string, id: string) => Promise<Detail>
  create: (
    csrfToken: string,
    input: Pick<SimpleAuxMutationInput, 'name' | 'description'>,
  ) => Promise<SimpleAuxMutationResult>
  save: (
    csrfToken: string,
    input: SimpleAuxMutationInput,
  ) => Promise<SimpleAuxMutationResult>
  setEnabled: (
    csrfToken: string,
    input: Pick<SimpleAuxMutationInput, 'id' | 'revision'>,
    enabled: boolean,
  ) => Promise<SimpleAuxMutationResult>
}

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

function createSimpleAuxManagementViewModel<
  Item extends SimpleAuxListItem,
  Detail extends SimpleAuxDetail,
>(operations: SimpleAuxOperations<Item, Detail>) {
  const session = useTargetSession()
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorLoading = ref(false)
  const saving = ref(false)
  const editorWriteBlocked = ref(false)
  const editorError = ref<string | null>(null)
  const detail = ref<Detail | null>(null)
  const lastCreatedId = ref<string | null>(null)
  const editor = reactive({
    id: '',
    name: '',
    description: '',
    revision: '',
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
    if (editorMode.value === 'create') return can(operations.paths.create)
    return Boolean(
      detail.value?.availableActions.includes('edit') &&
      can(operations.paths.get) &&
      can(operations.paths.save),
    )
  })

  function clearEditorFields(): void {
    Object.assign(editor, {
      id: '',
      name: '',
      description: '',
      revision: '',
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
    if (!can(operations.paths.create))
      editorError.value = `缺少新增${operations.title}权限。`
    return opening.promise
  }

  function openEdit(item: Item): Promise<'changed' | void> {
    const opening = beginEditor('edit')
    if (!can(operations.paths.get) || !can(operations.paths.save)) {
      editorError.value = `编辑${operations.title}需要详情和保存权限。`
      return opening.promise
    }
    const token = csrfFor(opening.generation, operations.paths.get)
    if (!token) {
      editorError.value = '会话已失效，无法加载编辑信息。'
      return opening.promise
    }
    editorLoading.value = true
    void operations
      .get(token, item.id)
      .then((current) => {
        if (!isEditorCurrent(opening)) return
        detail.value = current
        Object.assign(editor, {
          id: current.id,
          name: current.name,
          description: current.description,
          revision: current.revision,
        })
      })
      .catch((cause) => {
        if (!isEditorCurrent(opening)) return
        editorError.value = messageOf(
          cause,
          `${operations.title}编辑信息加载失败。`,
        )
      })
      .finally(() => {
        if (isEditorCurrent(opening)) editorLoading.value = false
      })
    return opening.promise
  }

  function validateEditor(): string | null {
    if (!editor.name.trim()) return '请输入名称。'
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
        description: editor.description.trim(),
      }
      if (editorMode.value === 'create') {
        const created = await operations.create(token, input)
        lastCreatedId.value = created.id
      } else
        await operations.save(token, {
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
        editorError.value = messageOf(cause, `${operations.title}保存失败。`)
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

  function canListAction(item: Item | null, action: ListAction): boolean {
    if (action === 'create') return can(operations.paths.create)
    if (action === 'delete') return false
    if (!item) return false
    if (action === 'edit')
      return (
        item.availableActions.includes('edit') &&
        can(operations.paths.get) &&
        can(operations.paths.save)
      )
    if (action === 'enable')
      return (
        item.availableActions.includes('enable') && can(operations.paths.enable)
      )
    return (
      item.availableActions.includes('disable') && can(operations.paths.disable)
    )
  }

  async function setEnabled(item: Item, enabled: boolean): Promise<'changed'> {
    const generation = session.generation
    const token = csrf()
    try {
      await operations.setEnabled(
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
            enabled
              ? `${operations.title}启用失败。`
              : `${operations.title}停用失败。`,
          ),
        )
      try {
        const readToken = csrfFor(generation, operations.paths.get)
        if (readToken) await operations.get(readToken, item.id)
      } catch {
        // A read can inform the operator but cannot prove this write.
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新后核实。',
      )
    }
  }

  const list = useListPageViewModel<Item>({
    ...(can(operations.paths.query)
      ? {
          onSearch: (input: ListSearchInput) => operations.query(csrf(), input),
        }
      : {}),
    ...(can(operations.paths.create) ? { onCreate: openCreate } : {}),
    ...(can(operations.paths.get) && can(operations.paths.save)
      ? { onEdit: openEdit }
      : {}),
    ...(can(operations.paths.enable)
      ? { onEnable: (item: Item) => setEnabled(item, true) }
      : {}),
    ...(can(operations.paths.disable)
      ? { onDisable: (item: Item) => setEnabled(item, false) }
      : {}),
    onCanAction: canListAction,
  })

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

type EmployeeCategoryPage = Awaited<
  ReturnType<typeof queryTargetEmployeeCategories>
>
export type EmployeeCategoryListItem = EmployeeCategoryPage['items'][number]
type EmployeeCategoryDetail = Awaited<
  ReturnType<typeof getTargetEmployeeCategory>
>
type PositionPage = Awaited<ReturnType<typeof queryTargetPositions>>
export type PositionListItem = PositionPage['items'][number]
type PositionDetail = Awaited<ReturnType<typeof getTargetPosition>>

export const employeeCategoryPaths = {
  query: '/aux/employee-category/query',
  get: '/aux/employee-category/get',
  create: '/aux/employee-category/create',
  save: '/aux/employee-category/save',
  enable: '/aux/employee-category/enable',
  disable: '/aux/employee-category/disable',
} as const

export const positionPaths = {
  query: '/aux/position/query',
  get: '/aux/position/get',
  create: '/aux/position/create',
  save: '/aux/position/save',
  enable: '/aux/position/enable',
  disable: '/aux/position/disable',
} as const

export function useEmployeeCategoryManagementViewModel() {
  return createSimpleAuxManagementViewModel<
    EmployeeCategoryListItem,
    EmployeeCategoryDetail
  >({
    title: '员工分类',
    createLabel: '新增员工分类',
    paths: employeeCategoryPaths,
    query: queryTargetEmployeeCategories,
    get: getTargetEmployeeCategory,
    create: createTargetEmployeeCategory,
    save: saveTargetEmployeeCategory,
    setEnabled: setTargetEmployeeCategoryEnabled,
  })
}

export function usePositionManagementViewModel() {
  return createSimpleAuxManagementViewModel<PositionListItem, PositionDetail>({
    title: '岗位',
    createLabel: '新增岗位',
    paths: positionPaths,
    query: queryTargetPositions,
    get: getTargetPosition,
    create: createTargetPosition,
    save: saveTargetPosition,
    setEnabled: setTargetPositionEnabled,
  })
}
