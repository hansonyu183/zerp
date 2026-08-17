import { computed, reactive, ref } from 'vue'
import { ApiError, getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { formatRoleAction, type AdminStatus } from '../shared/labels'
import {
  createAdminRole,
  getAdminRole,
  queryAdminPermissions,
  queryAdminRoles,
  saveAdminRole,
  setAdminRoleEnabled,
  type AdminPermission,
  type AdminRole,
  type AdminRoleDetail,
} from '../shared/api'

type EditorMode = 'create' | 'detail' | 'edit'
type PendingAction = {
  kind: 'enable' | 'disable'
  row: AdminRole
} | null

export interface RoleRowAction {
  key: 'VIEW' | 'EDIT' | 'ENABLE' | 'DISABLE'
  label: string
  icon: string
  color?: string
}

const isRevisionConflict = (error: unknown) =>
  error instanceof ApiError &&
  error.kind === 'business' &&
  ([3001, '3001'].includes(error.code ?? '') ||
    error.message === 'role revision conflict')

export function createRoleManagementViewModel() {
  const session = useSessionStore()
  const rows = ref<AdminRole[]>([])
  const permissions = ref<AdminPermission[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = 20 as const
  const keyword = ref('')
  const status = ref<AdminStatus | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const editorLoading = ref(false)
  const permissionsLoading = ref(false)
  const disposed = ref(false)
  const errorMessage = ref<string | null>(null)
  const queryErrorMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const permissionErrorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorOpen = ref(false)
  const editorMode = ref<EditorMode>('create')
  const editing = ref<AdminRoleDetail | null>(null)
  const discardConfirmOpen = ref(false)
  const pendingAction = ref<PendingAction>(null)
  const actionLoadingID = ref<string | null>(null)
  let querySequence = 0
  let editorLoadSequence = 0
  let appliedKeyword = ''
  let appliedStatus: AdminStatus | null = null
  let initialForm = ''
  const form = reactive({
    name: '',
    description: '',
    permissionIds: [] as string[],
  })

  const canCreate = computed(
    () =>
      session.can('/app/role/create') && session.can('/app/permission/query'),
  )
  const isCreate = computed(() => editorMode.value === 'create')
  const isDetail = computed(() => editorMode.value === 'detail')
  const isEdit = computed(() => editorMode.value === 'edit')
  const hasUnsavedChanges = computed(
    () =>
      editorOpen.value &&
      !isDetail.value &&
      JSON.stringify(form) !== initialForm,
  )
  const superadmin = computed(() => editing.value?.type === 'SUPERADMIN')

  const selectedPermissions = computed(() =>
    permissions.value.filter((permission) =>
      form.permissionIds.includes(permission.id),
    ),
  )
  const selectedDisabledPermissions = computed(() =>
    selectedPermissions.value.filter(
      (permission) => permission.status === 'DISABLED',
    ),
  )
  const validationError = computed(() => {
    if (isDetail.value) return ''
    if (!form.name.trim()) return '请输入角色名称。'
    if (form.permissionIds.length === 0) return '请至少选择一个启用权限。'
    if (selectedDisabledPermissions.value.length > 0) {
      return `已选权限包含已停用权限（${selectedDisabledPermissions.value.map((permission) => permission.path).join('、')}），请取消选择后再保存。`
    }
    const allAllowed = form.permissionIds.every((permissionID) =>
      permissions.value.some(
        (permission) =>
          permission.id === permissionID &&
          permission.status === 'ENABLED' &&
          permission.assignable !== false,
      ),
    )
    return allAllowed ? '' : '所选权限不可授予，请刷新权限目录后重新选择。'
  })
  const canSubmit = computed(
    () =>
      !saving.value &&
      !editorLoading.value &&
      !permissionsLoading.value &&
      !permissionErrorMessage.value &&
      !editorErrorMessage.value &&
      validationError.value === '' &&
      ((isCreate.value && canCreate.value) ||
        (isEdit.value &&
          Boolean(editing.value) &&
          canEditRole(editing.value as AdminRole))),
  )
  const pendingActionMessage = computed(() => {
    if (pendingAction.value?.kind === 'disable') {
      return `停用“${pendingAction.value.row.name}”后，关联用户将立即失去该角色的权限贡献。`
    }
    if (pendingAction.value?.kind === 'enable') {
      return `启用“${pendingAction.value.row.name}”后，当前仍启用的权限将重新产生权限贡献。`
    }
    return ''
  })

  function hasAction(row: AdminRole, action: RoleRowAction['key']): boolean {
    return row.availableActions.includes(action)
  }
  function canViewRole(row: AdminRole): boolean {
    return session.can('/app/role/get') && hasAction(row, 'VIEW')
  }
  function canEditRole(row: AdminRole): boolean {
    return (
      session.can('/app/role/get') &&
      session.can('/app/role/save') &&
      session.can('/app/permission/query') &&
      hasAction(row, 'EDIT')
    )
  }
  function canChangeEnabled(row: AdminRole): boolean {
    return row.status === 'ENABLED'
      ? session.can('/app/role/disable') && hasAction(row, 'DISABLE')
      : session.can('/app/role/enable') && hasAction(row, 'ENABLE')
  }
  function rowActions(row: AdminRole): RoleRowAction[] {
    const actions: RoleRowAction[] = []
    if (canViewRole(row)) {
      actions.push({
        key: 'VIEW',
        label: formatRoleAction('VIEW'),
        icon: 'mdi-eye-outline',
        color: 'primary',
      })
    }
    if (canEditRole(row)) {
      actions.push({
        key: 'EDIT',
        label: formatRoleAction('EDIT'),
        icon: 'mdi-pencil-outline',
        color: 'primary',
      })
    }
    const statusAction = row.status === 'ENABLED' ? 'DISABLE' : 'ENABLE'
    if (canChangeEnabled(row)) {
      actions.push({
        key: statusAction,
        label: formatRoleAction(statusAction),
        icon:
          statusAction === 'DISABLE'
            ? 'mdi-pause-circle-outline'
            : 'mdi-play-circle-outline',
      })
    }
    return actions
  }

  async function query(): Promise<void> {
    const sequence = ++querySequence
    loading.value = true
    queryErrorMessage.value = null
    try {
      const filters: { search?: string; status?: AdminStatus } = {}
      if (appliedKeyword) filters.search = appliedKeyword
      if (appliedStatus) filters.status = appliedStatus
      const result = await queryAdminRoles({
        page: page.value,
        pageSize,
        ...(Object.keys(filters).length ? { filters } : {}),
        sort: [{ field: 'code', order: 'asc' }],
      })
      if (disposed.value || sequence !== querySequence) return
      rows.value = result.data.items
      total.value = result.data.total
      const lastPage = Math.max(1, Math.ceil(result.data.total / pageSize))
      if (
        !result.data.items.length &&
        result.data.total > 0 &&
        page.value > lastPage
      ) {
        page.value = lastPage
        await query()
      }
    } catch (error) {
      if (!disposed.value && sequence === querySequence) {
        queryErrorMessage.value = `角色加载失败：${getErrorMessage(error)}`
      }
    } finally {
      if (!disposed.value && sequence === querySequence) loading.value = false
    }
  }
  async function search(): Promise<void> {
    appliedKeyword = keyword.value.trim()
    page.value = 1
    await query()
  }
  async function applyFilters(): Promise<void> {
    appliedKeyword = keyword.value.trim()
    appliedStatus = status.value
    page.value = 1
    await query()
  }
  async function resetFilters(): Promise<void> {
    keyword.value = ''
    status.value = null
    appliedKeyword = ''
    appliedStatus = null
    page.value = 1
    await query()
  }
  async function changePage(next: number): Promise<void> {
    if (next < 1 || next === page.value || loading.value) return
    page.value = next
    await query()
  }

  function resetForm(): void {
    form.name = ''
    form.description = ''
    form.permissionIds = []
    initialForm = JSON.stringify(form)
  }
  function setCleanForm(): void {
    initialForm = JSON.stringify(form)
  }
  function mergeDetailPermissions(detail: AdminRoleDetail): void {
    const catalog = new Map(
      permissions.value.map((permission) => [permission.id, permission]),
    )
    for (const permission of detail.permissions) {
      catalog.set(permission.id, {
        ...permission,
        revision: catalog.get(permission.id)?.revision ?? 1,
        assignable: catalog.get(permission.id)?.assignable ?? false,
      })
    }
    permissions.value = [...catalog.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    )
  }
  async function loadPermissions(
    sequence = editorLoadSequence,
  ): Promise<boolean> {
    permissionsLoading.value = true
    permissionErrorMessage.value = null
    try {
      const collected: AdminPermission[] = []
      let nextPage = 1
      let totalCount = 1
      while (collected.length < totalCount) {
        const result = await queryAdminPermissions({
          page: nextPage++,
          pageSize: 200,
          sort: [{ field: 'path', order: 'asc' }],
        })
        if (disposed.value || sequence !== editorLoadSequence) return false
        collected.push(...result.data.items)
        totalCount = result.data.total
        if (!result.data.items.length) break
      }
      permissions.value = collected
      return true
    } catch (error) {
      if (!disposed.value && sequence === editorLoadSequence) {
        permissionErrorMessage.value = `权限目录加载失败：${getErrorMessage(error)}`
      }
      return false
    } finally {
      if (!disposed.value && sequence === editorLoadSequence) {
        permissionsLoading.value = false
      }
    }
  }
  async function openCreate(): Promise<void> {
    const sequence = ++editorLoadSequence
    editorMode.value = 'create'
    editing.value = null
    editorErrorMessage.value = null
    resetForm()
    editorOpen.value = true
    await loadPermissions(sequence)
  }
  async function openDetail(row: AdminRole): Promise<void> {
    if (!canViewRole(row)) {
      errorMessage.value = '当前角色没有可用的查看动作。'
      return
    }
    await openExisting(row, 'detail')
  }
  async function openEdit(row: AdminRole): Promise<void> {
    if (!canEditRole(row)) {
      errorMessage.value = '当前角色不可编辑。'
      return
    }
    await openExisting(row, 'edit')
  }
  async function openExisting(row: AdminRole, mode: 'detail' | 'edit') {
    const sequence = ++editorLoadSequence
    editorMode.value = mode
    editorLoading.value = true
    editorErrorMessage.value = null
    permissionErrorMessage.value = null
    resetForm()
    editorOpen.value = true
    try {
      const permissionPromise =
        mode === 'edit' ? loadPermissions(sequence) : Promise.resolve(true)
      const [result, permissionsOK] = await Promise.all([
        getAdminRole(row.id),
        permissionPromise,
      ])
      if (disposed.value || sequence !== editorLoadSequence || !permissionsOK)
        return
      editing.value = result.data
      if (mode === 'edit') mergeDetailPermissions(result.data)
      form.name = result.data.name
      form.description = result.data.description ?? ''
      form.permissionIds = result.data.permissions.map(
        (permission) => permission.id,
      )
      setCleanForm()
    } catch (error) {
      if (!disposed.value && sequence === editorLoadSequence) {
        editorErrorMessage.value = `角色详情加载失败：${getErrorMessage(error)}`
      }
    } finally {
      if (!disposed.value && sequence === editorLoadSequence) {
        editorLoading.value = false
      }
    }
  }
  function closeEditor(force = false): boolean {
    if (!force && hasUnsavedChanges.value) {
      discardConfirmOpen.value = true
      return false
    }
    editorLoadSequence += 1
    editorOpen.value = false
    editing.value = null
    permissions.value = []
    permissionErrorMessage.value = null
    editorErrorMessage.value = null
    resetForm()
    return true
  }
  function requestCloseEditor(): boolean {
    return closeEditor()
  }
  function requestRouteLeave(): boolean {
    return closeEditor()
  }
  function confirmDiscard(): void {
    discardConfirmOpen.value = false
    closeEditor(true)
  }
  function cancelDiscard(): void {
    discardConfirmOpen.value = false
  }

  function permissionChecked(id: string): boolean {
    return form.permissionIds.includes(id)
  }
  function permissionDisabled(permission: AdminPermission): boolean {
    if (superadmin.value) return true
    if (permissionChecked(permission.id)) return false
    return permission.status !== 'ENABLED' || permission.assignable === false
  }
  function permissionLabel(permission: AdminPermission): string {
    const label = permission.description || '未命名权限'
    const statusLabel = permission.status === 'DISABLED' ? '（已停用）' : ''
    const ceilingLabel = permission.assignable === false ? '（不可授予）' : ''
    return `${label}${statusLabel}${ceilingLabel}`
  }
  function togglePermission(id: string, checked: boolean): void {
    const permission = permissions.value.find(
      (candidate) => candidate.id === id,
    )
    if (!permission || (checked && permissionDisabled(permission))) return
    form.permissionIds = checked
      ? [...new Set([...form.permissionIds, id])]
      : form.permissionIds.filter((permissionID) => permissionID !== id)
  }

  async function save(): Promise<void> {
    if (!canSubmit.value) {
      errorMessage.value =
        validationError.value ||
        permissionErrorMessage.value ||
        '当前角色不能保存。'
      return
    }
    saving.value = true
    editorErrorMessage.value = null
    try {
      if (isEdit.value && editing.value) {
        const result = await saveAdminRole({
          id: editing.value.id,
          name: form.name.trim(),
          description: form.description.trim() || null,
          permissionIds: [...form.permissionIds],
          revision: editing.value.revision,
        })
        editing.value = result.data
        successMessage.value = '角色已保存。'
      } else if (isCreate.value) {
        await createAdminRole({
          name: form.name.trim(),
          description: form.description.trim() || null,
          permissionIds: [...form.permissionIds],
        })
        successMessage.value = '角色已创建。'
      } else {
        return
      }
      closeEditor(true)
      await session.restore({ force: true })
      await query()
    } catch (error) {
      editorErrorMessage.value = isRevisionConflict(error)
        ? '角色详情已变化，请重新加载后再决定。'
        : getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  function requestChangeEnabled(row: AdminRole): void {
    if (!canChangeEnabled(row) || actionLoadingID.value) {
      errorMessage.value = '当前角色没有可用的状态动作。'
      return
    }
    pendingAction.value = {
      kind: row.status === 'ENABLED' ? 'disable' : 'enable',
      row,
    }
  }
  async function confirmPendingAction(): Promise<void> {
    const pending = pendingAction.value
    if (!pending || actionLoadingID.value) return
    actionLoadingID.value = pending.row.id
    errorMessage.value = null
    try {
      await setAdminRoleEnabled(pending.row, pending.kind === 'enable')
      successMessage.value =
        pending.kind === 'enable' ? '角色已启用。' : '角色已停用。'
      pendingAction.value = null
      await session.restore({ force: true })
      await query()
    } catch (error) {
      pendingAction.value = null
      if (isRevisionConflict(error)) {
        errorMessage.value = '角色状态已变化，已刷新事实，请重新发起决定。'
        await query()
      } else {
        errorMessage.value = getErrorMessage(error)
      }
    } finally {
      actionLoadingID.value = null
    }
  }
  function dispose(): void {
    disposed.value = true
    querySequence += 1
    editorLoadSequence += 1
  }

  return {
    rows,
    permissions,
    total,
    page,
    pageSize,
    keyword,
    status,
    loading,
    saving,
    editorLoading,
    permissionsLoading,
    errorMessage,
    queryErrorMessage,
    editorErrorMessage,
    permissionErrorMessage,
    successMessage,
    editorOpen,
    editorMode,
    editing,
    discardConfirmOpen,
    pendingAction,
    actionLoadingID,
    form,
    canCreate,
    isCreate,
    isDetail,
    isEdit,
    hasUnsavedChanges,
    superadmin,
    selectedPermissions,
    validationError,
    canSubmit,
    pendingActionMessage,
    canViewRole,
    canEditRole,
    canChangeEnabled,
    rowActions,
    query,
    search,
    applyFilters,
    resetFilters,
    changePage,
    loadPermissions,
    openCreate,
    openDetail,
    openEdit,
    closeEditor,
    requestCloseEditor,
    requestRouteLeave,
    confirmDiscard,
    cancelDiscard,
    permissionChecked,
    permissionDisabled,
    permissionLabel,
    togglePermission,
    save,
    requestChangeEnabled,
    confirmPendingAction,
    dispose,
  }
}
