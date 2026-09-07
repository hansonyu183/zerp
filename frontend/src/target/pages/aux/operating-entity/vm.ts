import { computed, reactive, ref } from 'vue'

import {
  createTargetOperatingEntity,
  getTargetOperatingEntity,
  queryTargetOperatingEntities,
  saveTargetOperatingEntity,
  setTargetOperatingEntityEnabled,
  TargetApiError,
} from '../../../api.ts'
import {
  ListActionRefreshRequiredError,
  ListActionUnresolvedError,
  useListPageViewModel,
  type ListAction,
  type ListSearchInput,
} from '../../../components/list-page/vm.ts'
import { useTargetSession } from '../../../session/vm.ts'

type Detail = Awaited<ReturnType<typeof getTargetOperatingEntity>>
export type OperatingEntityListItem = Awaited<
  ReturnType<typeof queryTargetOperatingEntities>
>['items'][number]

export const operatingEntityPaths = {
  query: '/aux/operating-entity/query',
  get: '/aux/operating-entity/get',
  create: '/aux/operating-entity/create',
  save: '/aux/operating-entity/save',
  enable: '/aux/operating-entity/enable',
  disable: '/aux/operating-entity/disable',
} as const

type EditorCompletion = {
  resolve: (result: 'changed' | void) => void
  reject: (cause: unknown) => void
}

const errors: Readonly<Record<string, string>> = {
  validation_failed: '输入内容不符合要求，请检查后重试。',
  forbidden: '当前账号没有执行此操作的权限。',
  unauthenticated: '会话已失效，请重新登录。',
  conflict: '当前经营主体状态已变化，请刷新列表后重试。',
  not_found: '经营主体不存在或已删除。',
  operating_entity_duplicate_legal_identifier:
    '统一社会信用代码已被其他经营主体使用。',
  internal_error: '经营主体服务暂时不可用，请稍后重试。',
}

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof TargetApiError)
    return errors[cause.errorKey] ?? cause.message ?? fallback
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function isConflict(cause: unknown): boolean {
  return cause instanceof TargetApiError && cause.errorKey === 'conflict'
}

export function useOperatingEntityManagementViewModel() {
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
    revision: '',
    legalName: '',
    shortName: '',
    legalIdentifier: '',
    registeredAddress: '',
    contactName: '',
    contactPhone: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remark: '',
  })
  let editorRequest = 0
  let completion: EditorCompletion | null = null
  let disposed = false

  const can = (path: string): boolean => session.can(path)
  const csrf = (): string => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const csrfFor = (generation: number, path: string): string | null =>
    !disposed &&
    generation === session.generation &&
    can(path) &&
    session.csrfToken
      ? session.csrfToken
      : null
  const current = (opening: { request: number; generation: number }): boolean =>
    !disposed &&
    opening.request === editorRequest &&
    opening.generation === session.generation

  const canSave = computed(() => {
    if (editorLoading.value || editorWriteBlocked.value) return false
    return editorMode.value === 'create'
      ? can(operatingEntityPaths.create)
      : Boolean(
          detail.value?.availableActions.includes('edit') &&
          can(operatingEntityPaths.get) &&
          can(operatingEntityPaths.save),
        )
  })

  function resetEditor(): void {
    Object.assign(editor, {
      id: '',
      revision: '',
      legalName: '',
      shortName: '',
      legalIdentifier: '',
      registeredAddress: '',
      contactName: '',
      contactPhone: '',
      invoiceTitle: '',
      invoiceAddress: '',
      invoicePhone: '',
      invoiceBank: '',
      invoiceAccount: '',
      remark: '',
    })
    detail.value = null
    editorError.value = null
    editorLoading.value = false
    saving.value = false
    editorWriteBlocked.value = false
  }

  function begin(mode: 'create' | 'edit') {
    completion?.resolve()
    editorRequest += 1
    resetEditor()
    if (mode === 'create') lastCreatedId.value = null
    editorMode.value = mode
    editorOpen.value = true
    const promise = new Promise<'changed' | void>((resolve, reject) => {
      completion = { resolve, reject }
    })
    return { request: editorRequest, generation: session.generation, promise }
  }

  function finish(result: 'changed' | void): void {
    const pending = completion
    completion = null
    editorRequest += 1
    editorOpen.value = false
    resetEditor()
    pending?.resolve(result)
  }

  function unresolved(message: string): void {
    const pending = completion
    completion = null
    editorWriteBlocked.value = true
    editorError.value = message
    pending?.reject(new ListActionUnresolvedError(message))
  }

  function openCreate(): Promise<'changed' | void> {
    const opening = begin('create')
    if (!can(operatingEntityPaths.create))
      editorError.value = '缺少新增经营主体权限。'
    return opening.promise
  }

  function openEdit(item: OperatingEntityListItem): Promise<'changed' | void> {
    const opening = begin('edit')
    if (!can(operatingEntityPaths.get) || !can(operatingEntityPaths.save)) {
      editorError.value = '编辑经营主体需要详情和保存权限。'
      return opening.promise
    }
    const token = csrfFor(opening.generation, operatingEntityPaths.get)
    if (!token) {
      editorError.value = '会话已失效，无法加载编辑信息。'
      return opening.promise
    }
    editorLoading.value = true
    void getTargetOperatingEntity(token, item.id)
      .then((value) => {
        if (!current(opening)) return
        detail.value = value
        Object.assign(editor, {
          id: value.id,
          revision: value.revision,
          legalName: value.legalName,
          shortName: value.shortName,
          legalIdentifier: value.legalIdentifier,
          registeredAddress: value.registeredAddress,
          contactName: value.contactName,
          contactPhone: value.contactPhone,
          invoiceTitle: value.invoiceTitle,
          invoiceAddress: value.invoiceAddress,
          invoicePhone: value.invoicePhone,
          invoiceBank: value.invoiceBank,
          invoiceAccount: value.invoiceAccount,
          remark: value.remark,
        })
      })
      .catch((cause) => {
        if (current(opening))
          editorError.value = messageOf(cause, '经营主体编辑信息加载失败。')
      })
      .finally(() => {
        if (current(opening)) editorLoading.value = false
      })
    return opening.promise
  }

  function input() {
    return {
      legalName: editor.legalName.trim(),
      shortName: editor.shortName.trim(),
      legalIdentifier: editor.legalIdentifier.trim(),
      registeredAddress: editor.registeredAddress.trim(),
      contactName: editor.contactName.trim(),
      contactPhone: editor.contactPhone.trim(),
      invoiceTitle: editor.invoiceTitle.trim(),
      invoiceAddress: editor.invoiceAddress.trim(),
      invoicePhone: editor.invoicePhone.trim(),
      invoiceBank: editor.invoiceBank.trim(),
      invoiceAccount: editor.invoiceAccount.trim(),
      remark: editor.remark.trim(),
    }
  }

  async function saveEditor(): Promise<void> {
    if (!completion || saving.value || !canSave.value) return
    if (!editor.legalName.trim() || !editor.legalIdentifier.trim()) {
      editorError.value = '请填写法定名称和统一社会信用代码。'
      return
    }
    const request = editorRequest
    const generation = session.generation
    saving.value = true
    editorError.value = null
    try {
      if (editorMode.value === 'create') {
        const created = await createTargetOperatingEntity(csrf(), input())
        if (!current({ request, generation })) return
        lastCreatedId.value = created.id
      } else
        await saveTargetOperatingEntity(csrf(), {
          id: editor.id,
          revision: editor.revision,
          ...input(),
        })
      if (current({ request, generation })) finish('changed')
    } catch (cause) {
      if (!current({ request, generation })) return
      if (isConflict(cause)) {
        editorError.value = messageOf(cause, '数据已变化，请刷新后重试。')
        editorWriteBlocked.value = true
      } else if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        editorError.value = messageOf(cause, '经营主体保存失败。')
      else unresolved('请求结果未知；已停止再次提交，请刷新后核实。')
    } finally {
      if (current({ request, generation })) saving.value = false
    }
  }

  function closeEditor(): void {
    if (!saving.value) finish()
  }

  function canListAction(
    item: OperatingEntityListItem | null,
    action: ListAction,
  ): boolean {
    if (action === 'create') return can(operatingEntityPaths.create)
    if (action === 'delete') return false
    if (!item) return false
    if (action === 'edit')
      return (
        item.availableActions.includes('edit') &&
        can(operatingEntityPaths.get) &&
        can(operatingEntityPaths.save)
      )
    return (
      item.availableActions.includes(action) &&
      can(operatingEntityPaths[action])
    )
  }

  async function setEnabled(
    item: OperatingEntityListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    try {
      await setTargetOperatingEntityEnabled(
        csrf(),
        { id: item.id, revision: item.revision },
        enabled,
      )
      return 'changed'
    } catch (cause) {
      if (disposed || generation !== session.generation) throw cause
      if (isConflict(cause))
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
            enabled ? '经营主体启用失败。' : '经营主体停用失败。',
          ),
        )
      try {
        const token = csrfFor(generation, operatingEntityPaths.get)
        if (token) await getTargetOperatingEntity(token, item.id)
      } catch {
        /* cannot prove the write */
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新后核实。',
      )
    }
  }

  const list = useListPageViewModel<OperatingEntityListItem>({
    ...(can(operatingEntityPaths.query)
      ? {
          onSearch: (value: ListSearchInput) =>
            queryTargetOperatingEntities(csrf(), value),
        }
      : {}),
    ...(can(operatingEntityPaths.create) ? { onCreate: openCreate } : {}),
    ...(can(operatingEntityPaths.get) && can(operatingEntityPaths.save)
      ? { onEdit: openEdit }
      : {}),
    ...(can(operatingEntityPaths.enable)
      ? { onEnable: (item) => setEnabled(item, true) }
      : {}),
    ...(can(operatingEntityPaths.disable)
      ? { onDisable: (item) => setEnabled(item, false) }
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
    finish()
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
