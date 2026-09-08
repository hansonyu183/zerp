import { computed, reactive, ref } from 'vue'

import {
  createTargetUser,
  getTargetUser,
  queryTargetRoles,
  queryTargetUsers,
  saveTargetUser,
  setTargetUserEnabled,
  TargetApiError,
} from '../../../api.ts'
import {
  ListActionRefreshRequiredError,
  ListActionUnresolvedError,
  useListPageViewModel,
  type ListAction,
} from '../../../components/list-page/vm.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { roleTypeLabels } from '../role/presentation.ts'

type UserPage = Awaited<ReturnType<typeof queryTargetUsers>>
export type UserListItem = UserPage['items'][number]
type UserDetail = Awaited<ReturnType<typeof getTargetUser>>
type RolePage = Awaited<ReturnType<typeof queryTargetRoles>>
type RoleItem = RolePage['items'][number]
type RoleCandidate = Pick<
  RoleItem,
  'id' | 'code' | 'name' | 'enabled' | 'type' | 'assignable'
>

export const userPaths = {
  query: '/app/user/query',
  get: '/app/user/get',
  create: '/app/user/create',
  save: '/app/user/save',
  enable: '/app/user/enable',
  disable: '/app/user/disable',
  roleQuery: '/app/role/query',
} as const

const userErrorMessages: Readonly<Record<string, string>> = {
  validation_failed: '输入内容不符合要求，请检查后重试。',
  forbidden: '当前账号没有执行此操作的权限。',
  unauthenticated: '会话已失效，请重新登录。',
  conflict: '用户编码已存在或当前状态不允许此操作。',
  not_found: '用户不存在或已删除。',
  internal_error: '用户服务暂时不可用，请稍后重试。',
  user_changed: '数据已被其他操作修改，请刷新列表后重试。',
}

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof TargetApiError)
    return userErrorMessages[cause.errorKey] ?? cause.message ?? fallback
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function isRevisionConflict(cause: unknown): boolean {
  return cause instanceof TargetApiError && cause.errorKey === 'user_changed'
}

type EditorCompletion = {
  resolve: (result: 'changed' | void) => void
  reject: (cause: unknown) => void
}

export function useUserManagementViewModel() {
  const session = useTargetSession()
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorLoading = ref(false)
  const saving = ref(false)
  const editorWriteBlocked = ref(false)
  const editorError = ref<string | null>(null)
  const detail = ref<UserDetail | null>(null)
  const roles = ref<RoleCandidate[]>([])
  const editor = reactive({
    id: '',
    code: '',
    name: '',
    password: '',
    roleIds: [] as string[],
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

  const roleOptions = computed(() => {
    return roles.value.map((role) => ({
      value: role.id,
      title: `${role.code} · ${role.name}（${role.enabled ? '启用' : '停用'} · ${roleTypeLabels[role.type]}）`,
      disabled:
        (!role.enabled || !role.assignable) &&
        !editor.roleIds.includes(role.id),
    }))
  })

  const rolesDisabled = computed(
    () =>
      editorLoading.value ||
      (editorMode.value === 'edit' && !detail.value?.roleAssignmentEditable),
  )

  const canSave = computed(() => {
    if (editorLoading.value || editorWriteBlocked.value) return false
    if (editorMode.value === 'create')
      return can(userPaths.create) && can(userPaths.roleQuery)
    return Boolean(
      detail.value?.manageable &&
      detail.value.availableActions.includes('EDIT') &&
      can(userPaths.get) &&
      can(userPaths.save) &&
      can(userPaths.roleQuery),
    )
  })

  const dependencyNotice = computed(() => {
    const messages: string[] = []
    if (can(userPaths.create) && !can(userPaths.roleQuery))
      messages.push('新增用户还需要角色查询权限，当前不会发送无权请求。')
    const hasSomeEditPath = can(userPaths.get) || can(userPaths.save)
    const hasAllEditPaths =
      can(userPaths.get) && can(userPaths.save) && can(userPaths.roleQuery)
    if (hasSomeEditPath && !hasAllEditPaths)
      messages.push('编辑用户需要详情、保存和角色查询权限。')
    return messages.join(' ')
  })

  function clearEditorFields(): void {
    Object.assign(editor, {
      id: '',
      code: '',
      name: '',
      password: '',
      roleIds: [],
      revision: '',
    })
    detail.value = null
    roles.value = []
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

  async function loadRoles(opening: {
    request: number
    generation: number
  }): Promise<RoleItem[]> {
    const all: RoleItem[] = []
    let nextPage = 1
    let total = 0
    do {
      if (!isEditorCurrent(opening)) return all
      const token = csrfFor(opening.generation, userPaths.roleQuery)
      if (!token) return all
      const result = await queryTargetRoles(token, {
        keyword: '',
        page: nextPage,
        pageSize: 20,
      })
      all.push(...result.items)
      total = result.total
      nextPage += 1
    } while (
      all.length < total &&
      isEditorCurrent(opening) &&
      csrfFor(opening.generation, userPaths.roleQuery) !== null
    )
    return all
  }

  function mergeRoleCandidates(
    activeRoles: readonly RoleItem[],
    assignedRoles: UserDetail['roles'],
  ): RoleCandidate[] {
    const candidates = new Map<string, RoleCandidate>(
      activeRoles.map((role) => [role.id, role]),
    )
    for (const role of assignedRoles) {
      if (!candidates.has(role.id)) candidates.set(role.id, role)
    }
    return [...candidates.values()].sort(
      (left, right) =>
        left.code.localeCompare(right.code) || left.id.localeCompare(right.id),
    )
  }

  function openCreate(): Promise<'changed' | void> {
    const opening = beginEditor('create')
    if (!can(userPaths.create) || !can(userPaths.roleQuery)) {
      editorError.value =
        '缺少新增用户或角色查询权限，无法选择可分配角色或新增用户。'
      return opening.promise
    }
    editorLoading.value = true
    void loadRoles(opening)
      .then((result) => {
        if (!isEditorCurrent(opening)) return
        roles.value = result
      })
      .catch((cause) => {
        if (!isEditorCurrent(opening)) return
        editorError.value = messageOf(cause, '角色选项加载失败。')
      })
      .finally(() => {
        if (isEditorCurrent(opening)) editorLoading.value = false
      })
    return opening.promise
  }

  function openEdit(item: UserListItem): Promise<'changed' | void> {
    const opening = beginEditor('edit')
    if (
      !can(userPaths.get) ||
      !can(userPaths.save) ||
      !can(userPaths.roleQuery)
    ) {
      editorError.value = '编辑用户需要详情、保存和角色查询权限。'
      return opening.promise
    }
    const token = csrfFor(opening.generation, userPaths.get)
    if (!token) {
      editorError.value = '会话已失效，无法加载用户编辑信息。'
      return opening.promise
    }
    editorLoading.value = true
    void Promise.all([getTargetUser(token, item.id), loadRoles(opening)])
      .then(([current, roleItems]) => {
        if (!isEditorCurrent(opening)) return
        detail.value = current
        roles.value = mergeRoleCandidates(roleItems, current.roles)
        Object.assign(editor, {
          id: current.id,
          code: current.code,
          name: current.name,
          password: '',
          roleIds: current.roles.map((role) => role.id),
          revision: current.revision,
        })
      })
      .catch((cause) => {
        if (!isEditorCurrent(opening)) return
        editorError.value = messageOf(cause, '用户编辑信息加载失败。')
      })
      .finally(() => {
        if (isEditorCurrent(opening)) editorLoading.value = false
      })
    return opening.promise
  }

  async function verifyCreatedUser(generation: number): Promise<void> {
    const token = csrfFor(generation, userPaths.query)
    if (!token) return
    // A unique matching row improves the operator's evidence, but without the
    // response ID it cannot prove which request created it. Keep the outcome
    // unresolved instead of risking a duplicate account.
    try {
      await queryTargetUsers(token, {
        keyword: editor.code.trim(),
        page: 1,
        pageSize: 20,
      })
    } catch {
      // The unresolved result below remains authoritative.
    }
  }

  function validateEditor(): string | null {
    if (!editor.name.trim()) return '请输入名称。'
    if (editor.roleIds.length === 0) return '请至少选择一个角色。'
    if (editorMode.value === 'create') {
      if (!editor.code.trim()) return '请输入用户编码。'
      if (!editor.password) return '请输入初始密码。'
    }
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
      if (editorMode.value === 'create') {
        await createTargetUser(token, {
          code: editor.code.trim(),
          name: editor.name.trim(),
          password: editor.password,
          roleIds: [...editor.roleIds],
        })
      } else {
        await saveTargetUser(token, {
          id: editor.id,
          name: editor.name.trim(),
          roleIds: [...editor.roleIds],
          revision: editor.revision,
        })
      }
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
        editorError.value = messageOf(cause, '用户保存失败。')
        return
      }
      if (editorMode.value === 'create') await verifyCreatedUser(generation)
      if (
        !disposed &&
        request === editorRequest &&
        generation === session.generation
      )
        failEditorUnresolved(
          can(userPaths.query)
            ? '请求结果未知；查询核实未能确认结果，已停止再次提交。'
            : '请求结果未知；当前账号没有查询权限，无法核实，已停止再次提交。',
        )
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

  function canListAction(item: UserListItem | null, action: ListAction) {
    if (action === 'create') return can(userPaths.create)
    if (action === 'delete') return false
    if (!item) return false
    if (action === 'edit')
      return (
        item.availableActions.includes('VIEW') &&
        item.availableActions.includes('EDIT') &&
        can(userPaths.get) &&
        can(userPaths.save) &&
        can(userPaths.roleQuery)
      )
    if (action === 'enable')
      return item.availableActions.includes('ENABLE') && can(userPaths.enable)
    return item.availableActions.includes('DISABLE') && can(userPaths.disable)
  }

  async function setEnabled(
    item: UserListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    const token = csrf()
    try {
      await setTargetUserEnabled(
        token,
        { id: item.id, revision: item.revision },
        enabled,
      )
      return 'changed'
    } catch (cause) {
      if (disposed || generation !== session.generation) throw cause
      if (isRevisionConflict(cause))
        throw new ListActionRefreshRequiredError(
          messageOf(cause, '数据已变化，请刷新后重试。'),
        )
      if (cause instanceof TargetApiError && cause.errorKey === 'conflict')
        throw new ListActionRefreshRequiredError(
          '用户状态已经变化或不允许此操作，请刷新列表后再试。',
        )
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        throw new Error(
          messageOf(cause, enabled ? '用户启用失败。' : '用户停用失败。'),
        )
      try {
        const readToken = csrfFor(generation, userPaths.get)
        if (readToken) await getTargetUser(readToken, item.id)
        else {
          const queryToken = csrfFor(generation, userPaths.query)
          if (queryToken)
            await queryTargetUsers(queryToken, {
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

  const list = useListPageViewModel<UserListItem>({
    ...(can(userPaths.query)
      ? {
          onSearch: (input: { keyword: string; page: number; pageSize: 20 }) =>
            queryTargetUsers(csrf(), input),
        }
      : {}),
    ...(can(userPaths.create) ? { onCreate: openCreate } : {}),
    ...(can(userPaths.get) && can(userPaths.save) && can(userPaths.roleQuery)
      ? { onEdit: openEdit }
      : {}),
    ...(can(userPaths.enable)
      ? { onEnable: (item: UserListItem) => setEnabled(item, true) }
      : {}),
    ...(can(userPaths.disable)
      ? { onDisable: (item: UserListItem) => setEnabled(item, false) }
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
    roleOptions,
    rolesDisabled,
    canSave,
    dependencyNotice,
    openCreate,
    openEdit,
    saveEditor,
    closeEditor,
    dispose,
  }
}
