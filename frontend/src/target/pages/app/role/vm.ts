import { computed, reactive, ref } from 'vue'

import {
  createTargetRole,
  getTargetRole,
  queryTargetPermissions,
  queryTargetRoles,
  saveTargetRole,
  setTargetRoleEnabled,
  TargetApiError,
} from '../../../api.ts'
import {
  ListActionUnresolvedError,
  useListPageViewModel,
  type ListAction,
} from '../../../components/list-page/vm.ts'
import {
  domainDisplayName,
  resourceDisplayName,
} from '../../../navigation/resources.ts'
import { useTargetSession } from '../../../session/vm.ts'

type RolePage = Awaited<ReturnType<typeof queryTargetRoles>>
export type RoleListItem = RolePage['items'][number]
type RoleDetail = Awaited<ReturnType<typeof getTargetRole>>
type PermissionPage = Awaited<ReturnType<typeof queryTargetPermissions>>
type PermissionItem = PermissionPage['items'][number]
type PermissionCandidate = Pick<
  PermissionItem,
  'id' | 'path' | 'domain' | 'entity' | 'action' | 'description' | 'status'
>

type PermissionOption = {
  title: string
  value: string
  disabled: boolean
}

type PermissionGroup = { type: 'subheader'; title: string }

const permissionStatusLabels = {
  ENABLED: '启用',
  DISABLED: '停用',
} as const satisfies Record<PermissionCandidate['status'], string>

export const permissionActionLabels: Readonly<Record<string, string>> = {
  query: '查询',
  get: '查看',
  create: '新增',
  save: '保存',
  enable: '启用',
  disable: '停用',
  delete: '删除',
  reset: '重置',
  'reset-password': '重置密码',
  approve: '审批',
  'approve-child': '审批子单据',
  'approve-over-credit-limit': '超信用额度审批',
  reject: '驳回',
  'reject-child': '驳回子单据',
  'attachment-cleanup': '清理附件',
  'attachment-read': '读取附件',
  'attachment-stage': '暂存附件',
  'audit-history': '查看审核历史',
  'cancel-child': '取消子单据',
  catalog: '查看目录',
  'create-child': '创建子单据',
  lock: '锁定',
  'open-document': '打开单据',
  reference: '查询引用',
  'retry-child': '重试子单据',
  'save-subunits': '保存子项',
  'submit-change': '提交变更',
  'submit-new': '提交新建',
  trial: '试算',
  unapprove: '反审批',
  unlock: '解锁',
  unreject: '撤销驳回',
  versions: '查看版本',
  export: '导出',
}

function permissionTitle(permission: PermissionCandidate): string {
  const action = permissionActionLabels[permission.action] ?? permission.action
  const description = permission.description
    ? `：${permission.description}`
    : ''
  return `${domainDisplayName(permission.domain)} · ${resourceDisplayName(permission.domain, permission.entity)} · ${action}（${permissionStatusLabels[permission.status]}）${description}`
}

export const rolePaths = {
  query: '/app/role/query',
  get: '/app/role/get',
  create: '/app/role/create',
  save: '/app/role/save',
  enable: '/app/role/enable',
  disable: '/app/role/disable',
  permissionQuery: '/app/permission/query',
} as const

const roleErrorMessages: Readonly<Record<string, string>> = {
  validation_failed: '输入内容不符合要求，请检查后重试。',
  forbidden: '当前账号没有执行此操作的权限。',
  unauthenticated: '会话已失效，请重新登录。',
  conflict: '当前角色状态不允许此操作。',
  not_found: '角色不存在或已删除。',
  role_changed: '数据已被其他操作修改，请刷新列表后重试。',
  role_name_exists: '角色名称已存在。',
  internal_error: '角色服务暂时不可用，请稍后重试。',
}

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof TargetApiError)
    return roleErrorMessages[cause.errorKey] ?? cause.message ?? fallback
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function isRevisionConflict(cause: unknown): boolean {
  return cause instanceof TargetApiError && cause.errorKey === 'role_changed'
}

type EditorCompletion = {
  resolve: (result: 'changed' | void) => void
  reject: (cause: unknown) => void
}

export function useRoleManagementViewModel() {
  const session = useTargetSession()
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorLoading = ref(false)
  const saving = ref(false)
  const editorWriteBlocked = ref(false)
  const editorError = ref<string | null>(null)
  const detail = ref<RoleDetail | null>(null)
  const permissions = ref<PermissionCandidate[]>([])
  const editor = reactive({
    id: '',
    name: '',
    description: null as string | null,
    permissionIds: [] as string[],
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

  const permissionOptions = computed(() => {
    const groups = new Map<string, PermissionOption[]>()
    for (const permission of permissions.value) {
      const group = `${domainDisplayName(permission.domain)} · ${resourceDisplayName(permission.domain, permission.entity)}`
      const items = groups.get(group) ?? []
      items.push({
        value: permission.id,
        title: permissionTitle(permission),
        disabled:
          permission.status === 'DISABLED' &&
          !editor.permissionIds.includes(permission.id),
      })
      groups.set(group, items)
    }
    return [...groups.entries()].flatMap(([title, items]) => [
      { type: 'subheader' as const, title },
      ...items,
    ]) satisfies Array<PermissionGroup | PermissionOption>
  })

  const selectedStoppedPermission = computed(() =>
    permissions.value.find(
      (permission) =>
        editor.permissionIds.includes(permission.id) &&
        permission.status === 'DISABLED',
    ),
  )

  const permissionSelectionValid = computed(
    () => editor.permissionIds.length > 0 && !selectedStoppedPermission.value,
  )

  const canSave = computed(() => {
    if (
      editorLoading.value ||
      editorWriteBlocked.value ||
      !permissionSelectionValid.value
    )
      return false
    if (editorMode.value === 'create')
      return can(rolePaths.create) && can(rolePaths.permissionQuery)
    return Boolean(
      detail.value?.manageable &&
      detail.value.availableActions.includes('edit') &&
      can(rolePaths.get) &&
      can(rolePaths.save) &&
      can(rolePaths.permissionQuery),
    )
  })

  const dependencyNotice = computed(() => {
    const messages: string[] = []
    if (can(rolePaths.create) && !can(rolePaths.permissionQuery))
      messages.push('新增角色还需要权限目录查询权限，当前不会发送无权请求。')
    const hasSomeEditPath = can(rolePaths.get) || can(rolePaths.save)
    const hasAllEditPaths =
      can(rolePaths.get) &&
      can(rolePaths.save) &&
      can(rolePaths.permissionQuery)
    if (hasSomeEditPath && !hasAllEditPaths)
      messages.push('编辑角色需要详情、保存和权限目录查询权限。')
    return messages.join(' ')
  })

  function clearEditorFields(): void {
    Object.assign(editor, {
      id: '',
      name: '',
      description: null,
      permissionIds: [],
      revision: '',
    })
    detail.value = null
    permissions.value = []
    editorError.value = null
    editorLoading.value = false
    saving.value = false
    editorWriteBlocked.value = false
  }

  function beginEditor(mode: 'create' | 'edit') {
    if (editorCompletion) editorCompletion.resolve()
    editorRequest += 1
    clearEditorFields()
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

  async function loadPermissions(opening: {
    request: number
    generation: number
  }): Promise<PermissionItem[]> {
    const all: PermissionItem[] = []
    let nextPage = 1
    let total = 0
    do {
      if (!isEditorCurrent(opening)) return all
      const token = csrfFor(opening.generation, rolePaths.permissionQuery)
      if (!token) return all
      const result = await queryTargetPermissions(token, {
        page: nextPage,
        pageSize: 20,
      })
      all.push(...result.items)
      total = result.total
      nextPage += 1
    } while (
      all.length < total &&
      isEditorCurrent(opening) &&
      csrfFor(opening.generation, rolePaths.permissionQuery) !== null
    )
    return all
  }

  function mergePermissionCandidates(
    listedPermissions: readonly PermissionItem[],
    assignedPermissions: RoleDetail['permissions'],
  ): PermissionCandidate[] {
    const candidates = new Map<string, PermissionCandidate>(
      listedPermissions.map((permission) => [permission.id, permission]),
    )
    for (const permission of assignedPermissions) {
      if (!candidates.has(permission.id))
        candidates.set(permission.id, permission)
    }
    return [...candidates.values()].sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.id.localeCompare(right.id),
    )
  }

  function openCreate(): Promise<'changed' | void> {
    const opening = beginEditor('create')
    if (!can(rolePaths.create) || !can(rolePaths.permissionQuery)) {
      editorError.value =
        '缺少新增角色或权限目录查询权限，无法选择权限或新增角色。'
      return opening.promise
    }
    editorLoading.value = true
    void loadPermissions(opening)
      .then((result) => {
        if (!isEditorCurrent(opening)) return
        permissions.value = result
      })
      .catch((cause) => {
        if (!isEditorCurrent(opening)) return
        editorError.value = messageOf(cause, '权限目录加载失败。')
      })
      .finally(() => {
        if (isEditorCurrent(opening)) editorLoading.value = false
      })
    return opening.promise
  }

  function openEdit(item: RoleListItem): Promise<'changed' | void> {
    const opening = beginEditor('edit')
    if (
      !can(rolePaths.get) ||
      !can(rolePaths.save) ||
      !can(rolePaths.permissionQuery)
    ) {
      editorError.value = '编辑角色需要详情、保存和权限目录查询权限。'
      return opening.promise
    }
    const token = csrfFor(opening.generation, rolePaths.get)
    if (!token) {
      editorError.value = '会话已失效，无法加载角色编辑信息。'
      return opening.promise
    }
    editorLoading.value = true
    void Promise.all([getTargetRole(token, item.id), loadPermissions(opening)])
      .then(([current, permissionItems]) => {
        if (!isEditorCurrent(opening)) return
        detail.value = current
        permissions.value = mergePermissionCandidates(
          permissionItems,
          current.permissions,
        )
        Object.assign(editor, {
          id: current.id,
          name: current.name,
          description: current.description,
          permissionIds: current.permissions.map((permission) => permission.id),
          revision: current.revision,
        })
        if (selectedStoppedPermission.value)
          editorError.value = '已关联停用权限；请明确移除后再保存。'
      })
      .catch((cause) => {
        if (!isEditorCurrent(opening)) return
        editorError.value = messageOf(cause, '角色编辑信息加载失败。')
      })
      .finally(() => {
        if (isEditorCurrent(opening)) editorLoading.value = false
      })
    return opening.promise
  }

  function validateEditor(): string | null {
    if (!editor.name.trim()) return '请输入名称。'
    if (editor.permissionIds.length === 0) return '请至少选择一个权限。'
    if (selectedStoppedPermission.value)
      return '已关联停用权限，请明确移除后再保存。'
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
        description: editor.description?.trim() || null,
        permissionIds: [...editor.permissionIds],
      }
      if (editorMode.value === 'create') await createTargetRole(token, input)
      else
        await saveTargetRole(token, {
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
        editorError.value = messageOf(cause, '角色保存失败。')
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

  function canListAction(item: RoleListItem | null, action: ListAction) {
    if (action === 'create') return can(rolePaths.create)
    if (!item) return false
    if (action === 'edit')
      return (
        item.availableActions.includes('edit') &&
        can(rolePaths.get) &&
        can(rolePaths.save) &&
        can(rolePaths.permissionQuery)
      )
    if (action === 'enable')
      return item.availableActions.includes('enable') && can(rolePaths.enable)
    return item.availableActions.includes('disable') && can(rolePaths.disable)
  }

  async function setEnabled(
    item: RoleListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    const token = csrf()
    try {
      await setTargetRoleEnabled(
        token,
        { id: item.id, revision: item.revision },
        enabled,
      )
      return 'changed'
    } catch (cause) {
      if (disposed || generation !== session.generation) throw cause
      if (isRevisionConflict(cause))
        throw new ListActionUnresolvedError(
          messageOf(cause, '数据已变化，请刷新列表后重试。'),
        )
      if (cause instanceof TargetApiError && cause.errorKey === 'conflict')
        throw new ListActionUnresolvedError(
          '角色状态已经变化或不允许此操作，请刷新列表后再试。',
        )
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        throw new Error(
          messageOf(cause, enabled ? '角色启用失败。' : '角色停用失败。'),
        )
      try {
        const readToken = csrfFor(generation, rolePaths.get)
        if (readToken) await getTargetRole(readToken, item.id)
        else {
          const queryToken = csrfFor(generation, rolePaths.query)
          if (queryToken)
            await queryTargetRoles(queryToken, {
              keyword: item.code,
              page: 1,
              pageSize: 20,
            })
        }
      } catch {
        // A read can inform the operator but cannot prove this write.
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新列表后核实。',
      )
    }
  }

  const list = useListPageViewModel<RoleListItem>({
    ...(can(rolePaths.query)
      ? {
          onSearch: (input: { keyword: string; page: number; pageSize: 20 }) =>
            queryTargetRoles(csrf(), input),
        }
      : {}),
    ...(can(rolePaths.create) ? { onCreate: openCreate } : {}),
    ...(can(rolePaths.get) &&
    can(rolePaths.save) &&
    can(rolePaths.permissionQuery)
      ? { onEdit: openEdit }
      : {}),
    ...(can(rolePaths.enable)
      ? { onEnable: (item: RoleListItem) => setEnabled(item, true) }
      : {}),
    ...(can(rolePaths.disable)
      ? { onDisable: (item: RoleListItem) => setEnabled(item, false) }
      : {}),
    onCanAction: canListAction,
  })

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
    editor,
    detail,
    permissionOptions,
    canSave,
    dependencyNotice,
    openCreate,
    openEdit,
    saveEditor,
    closeEditor,
    dispose,
  }
}
