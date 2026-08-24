import { computed, reactive, ref } from 'vue'
import { getErrorMessage, ApiError } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { passwordMaxLength, passwordMeetsPolicy } from '@/utils/password-policy'
import {
  createAdminUser,
  getAdminUser,
  queryAdminRoles,
  queryAdminUsers,
  resetAdminUserPassword,
  saveAdminUser,
  setAdminUserEnabled,
  type AdminRole,
  type AdminStatus,
  type AdminUser,
  type AdminUserDetail,
} from '../shared/api'

type EditorMode = 'create' | 'edit' | 'detail'
type PendingAction = {
  kind: 'enable' | 'disable' | 'reset'
  row: AdminUser
} | null
const isRevisionConflict = (error: unknown) =>
  error instanceof ApiError &&
  error.kind === 'business' &&
  error.errorKey === 'user_changed'
const runeLength = (value: string) => Array.from(value).length

export function createUserManagementViewModel() {
  const session = useSessionStore()
  const rows = ref<AdminUser[]>([]),
    roles = ref<AdminRole[]>([]),
    total = ref(0)
  const page = ref(1),
    pageSize = ref(20),
    keyword = ref(''),
    status = ref<AdminStatus | null>(null)
  const loading = ref(false),
    saving = ref(false),
    rolesLoading = ref(false),
    disposed = ref(false)
  const errorMessage = ref<string | null>(null),
    queryErrorMessage = ref<string | null>(null),
    successMessage = ref<string | null>(null),
    roleErrorMessage = ref<string | null>(null),
    editorErrorMessage = ref<string | null>(null)
  const editorOpen = ref(false),
    editorMode = ref<EditorMode>('create'),
    editing = ref<AdminUserDetail | null>(null)
  const pendingAction = ref<PendingAction>(null),
    actionLoadingID = ref<string | null>(null)
  const temporaryPassword = ref<string | null>(null),
    passwordSaved = ref(false),
    copyErrorMessage = ref<string | null>(null)
  const discardConfirmOpen = ref(false),
    closeAfterDiscard = ref(false)
  let querySequence = 0,
    editorLoadSequence = 0
  let appliedKeyword = '',
    appliedStatus: AdminStatus | null = null
  let editorTarget: { row: AdminUser; mode: EditorMode } | null = null
  const form = reactive({
    username: '',
    displayName: '',
    password: '',
    roleIds: [] as string[],
  })
  let initialForm = ''

  const canReadRoles = computed(() => session.can('/app/role/query'))
  const passwordMinLength = computed(() => session.passwordMinLength)
  const canGet = computed(() => session.can('/app/user/get'))
  const canCreate = computed(
    () => session.can('/app/user/create') && canReadRoles.value,
  )
  const canSave = computed(() => session.can('/app/user/save'))
  const canEdit = computed(
    () => canGet.value && canSave.value && canReadRoles.value,
  )
  const canEnable = computed(() => session.can('/app/user/enable'))
  const canDisable = computed(() => session.can('/app/user/disable'))
  const canResetPassword = computed(
    () =>
      session.can('/app/user/reset-password') && session.can('/app/user/query'),
  )
  const isCreate = computed(() => editorMode.value === 'create')
  const isEdit = computed(() => editorMode.value === 'edit')
  const isDetail = computed(() => editorMode.value === 'detail')
  const isSelf = computed(() => editing.value?.id === session.user?.id)
  const rolesReadonly = computed(
    () =>
      isDetail.value ||
      isSelf.value ||
      editing.value?.roleAssignmentEditable === false ||
      (isEdit.value && !editing.value),
  )
  const hasUnsavedChanges = computed(
    () =>
      editorOpen.value &&
      !isDetail.value &&
      JSON.stringify(form) !== initialForm,
  )

  function isSystemUser(row: AdminUser): boolean {
    return row.system
  }
  function canEditUser(row: AdminUser): boolean {
    return !isSystemUser(row) && row.manageable && canEdit.value
  }
  function canViewUser(row: AdminUser): boolean {
    return canGet.value && !canEditUser(row)
  }
  function canChangeEnabled(row: AdminUser): boolean {
    if (isSystemUser(row) || !row.manageable || row.id === session.user?.id)
      return false
    return row.status === 'ENABLED' ? canDisable.value : canEnable.value
  }
  function canResetUserPassword(row: AdminUser): boolean {
    return (
      !isSystemUser(row) &&
      row.manageable &&
      row.id !== session.user?.id &&
      row.status === 'ENABLED' &&
      canResetPassword.value
    )
  }
  const roleOptions = computed(() =>
    roles.value
      .filter(
        (role) =>
          (role.status === 'ENABLED' && role.assignable) ||
          (!isCreate.value && form.roleIds.includes(role.id)),
      )
      .map((role) => {
        const selected = form.roleIds.includes(role.id)
        const disabled =
          (!selected && (role.status === 'DISABLED' || !role.assignable)) ||
          editing.value?.roleAssignmentEditable === false
        return {
          title: `${role.code} · ${role.name}${role.status === 'DISABLED' ? '（已停用）' : !role.assignable ? '（不可分配）' : ''}`,
          value: role.id,
          props: { disabled, 'aria-disabled': disabled || undefined },
        }
      }),
  )
  const selectedDisabledRoles = computed(() =>
    roles.value.filter(
      (role) => role.status === 'DISABLED' && form.roleIds.includes(role.id),
    ),
  )
  const validationError = computed(() => {
    if (isDetail.value || (isEdit.value && !editing.value)) return ''
    if (
      isCreate.value &&
      (runeLength(form.username.trim()) < 3 ||
        runeLength(form.username.trim()) > 64)
    )
      return '用户名应为 3 至 64 个字符。'
    if (
      runeLength(form.displayName.trim()) < 1 ||
      runeLength(form.displayName.trim()) > 128
    )
      return '显示名称应为 1 至 128 个字符。'
    if (isCreate.value && !form.password) return '请输入初始密码。'
    if (editing.value && isSelf.value) return ''
    if (editing.value && !editing.value.manageable) return ''
    if (
      isCreate.value &&
      !passwordMeetsPolicy(form.password, session.passwordMinLength)
    )
      return `初始密码应为 ${session.passwordMinLength} 至 ${passwordMaxLength} 个字符，且包含大小写字母、数字和符号。`
    if (form.roleIds.length === 0) return '请至少选择一个启用角色。'
    if (selectedDisabledRoles.value.length)
      return `已选角色包含已停用角色（${selectedDisabledRoles.value.map((role) => role.name).join('、')}），请移除后再保存。`
    if (
      !form.roleIds.every((id) =>
        roles.value.some(
          (role) =>
            role.id === id && role.status === 'ENABLED' && role.assignable,
        ),
      )
    )
      return '所选角色不存在或未启用，请重新选择。'
    return ''
  })
  const canSubmit = computed(
    () =>
      !saving.value &&
      !rolesLoading.value &&
      !roleErrorMessage.value &&
      !editorErrorMessage.value &&
      validationError.value === '' &&
      ((isCreate.value && canCreate.value) ||
        (isEdit.value && Boolean(editing.value?.manageable) && canEdit.value)),
  )

  function resetForm(): void {
    form.username = ''
    form.displayName = ''
    form.password = ''
    form.roleIds = []
    initialForm = JSON.stringify(form)
  }
  function clearTemporaryPassword(): void {
    temporaryPassword.value = null
    passwordSaved.value = false
    copyErrorMessage.value = null
  }
  function setCleanForm(): void {
    initialForm = JSON.stringify(form)
  }
  function dispose(): void {
    disposed.value = true
    querySequence += 1
    editorLoadSequence += 1
    clearTemporaryPassword()
  }
  async function query(): Promise<void> {
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    queryErrorMessage.value = null
    try {
      const filters: Record<string, string> = {}
      if (appliedKeyword) filters.search = appliedKeyword
      if (appliedStatus) filters.status = appliedStatus
      const result = await queryAdminUsers({
        page: page.value,
        pageSize: 20,
        filters,
        sort: [{ field: 'username', order: 'asc' }],
      })
      if (disposed.value || sequence !== querySequence) return
      const lastPage = Math.max(1, Math.ceil(result.data.total / 20))
      if (
        !result.data.items.length &&
        result.data.total > 0 &&
        page.value > lastPage
      ) {
        page.value = lastPage
        await query()
        return
      }
      rows.value = result.data.items
      total.value = result.data.total
    } catch (error) {
      if (!disposed.value && sequence === querySequence)
        queryErrorMessage.value = `用户加载失败：${getErrorMessage(error)}`
    } finally {
      if (!disposed.value && sequence === querySequence) loading.value = false
    }
  }
  async function loadRoles(sequence = editorLoadSequence): Promise<boolean> {
    rolesLoading.value = true
    roleErrorMessage.value = null
    try {
      const collected: AdminRole[] = []
      let nextPage = 1,
        totalCount = 1
      while (collected.length < totalCount) {
        const result = await queryAdminRoles({
          page: nextPage++,
          pageSize: 20,
          sort: [{ field: 'code', order: 'asc' }],
        })
        if (disposed.value || sequence !== editorLoadSequence) return false
        collected.push(...result.data.items)
        totalCount = result.data.total
        if (!result.data.items.length) break
      }
      roles.value = collected.filter((role) => role.type !== 'SYSTEM')
      return true
    } catch (error) {
      if (!disposed.value && sequence === editorLoadSequence)
        roleErrorMessage.value = `角色加载失败：${getErrorMessage(error)}`
      return false
    } finally {
      if (!disposed.value && sequence === editorLoadSequence)
        rolesLoading.value = false
    }
  }
  async function retryRoles(): Promise<void> {
    if (editorTarget) {
      await openEditor(editorTarget.row, editorTarget.mode)
      return
    }
    await loadRoles()
  }
  async function retryEditor(): Promise<void> {
    if (editorTarget) await openEditor(editorTarget.row, editorTarget.mode)
  }
  async function search(): Promise<void> {
    appliedKeyword = keyword.value.trim()
    page.value = 1
    await query()
  }
  async function applyFilters(): Promise<void> {
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
    if (next >= 1 && next !== page.value && !loading.value) {
      page.value = next
      await query()
    }
  }
  async function openCreate(): Promise<void> {
    const sequence = ++editorLoadSequence
    editorTarget = null
    editing.value = null
    editorMode.value = 'create'
    editorErrorMessage.value = null
    resetForm()
    editorOpen.value = true
    await loadRoles(sequence)
  }
  async function openDetail(row: AdminUser): Promise<void> {
    await openEditor(row, 'detail')
  }
  async function openEdit(row: AdminUser): Promise<void> {
    if (!canEditUser(row)) {
      errorMessage.value = isSystemUser(row)
        ? '系统用户由服务端维护，不能编辑。'
        : '没有权限编辑用户。'
      return
    }
    await openEditor(row, 'edit')
  }
  async function openEditor(row: AdminUser, mode: EditorMode): Promise<void> {
    const sequence = ++editorLoadSequence
    editorTarget = { row, mode }
    loading.value = true
    errorMessage.value = null
    roleErrorMessage.value = null
    editorErrorMessage.value = null
    editorOpen.value = true
    editorMode.value = mode
    resetForm()
    try {
      const detailPromise = getAdminUser(row.id)
      const rolePromise =
        mode === 'detail' ? Promise.resolve(true) : loadRoles(sequence)
      const [detail, rolesOK] = await Promise.all([detailPromise, rolePromise])
      if (disposed.value || sequence !== editorLoadSequence || !rolesOK) return
      editing.value = detail.data
      if (mode === 'edit' && !detail.data.manageable) {
        editorMode.value = 'detail'
      }
      const catalog = new Map(roles.value.map((role) => [role.id, role]))
      for (const role of detail.data.roles) {
        if (catalog.has(role.id) || role.type === 'SYSTEM') continue
        catalog.set(role.id, {
          ...role,
          description: null,
          availableActions: [],
          createdAt: '',
          updatedAt: '',
          revision: 1,
        })
      }
      roles.value = [...catalog.values()]
      form.username = detail.data.username
      form.displayName = detail.data.displayName
      form.roleIds = detail.data.roles.map((role) => role.id)
      setCleanForm()
    } catch (error) {
      if (!disposed.value && sequence === editorLoadSequence)
        editorErrorMessage.value = `用户详情加载失败：${getErrorMessage(error)}`
    } finally {
      if (!disposed.value && sequence === editorLoadSequence)
        loading.value = false
    }
  }
  function closeEditor(force = false): void {
    if (!force && hasUnsavedChanges.value) {
      closeAfterDiscard.value = true
      discardConfirmOpen.value = true
      return
    }
    editorLoadSequence += 1
    editorOpen.value = false
    editing.value = null
    editorTarget = null
    resetForm()
    roleErrorMessage.value = null
    editorErrorMessage.value = null
  }
  function confirmDiscard(): void {
    discardConfirmOpen.value = false
    if (closeAfterDiscard.value) closeEditor(true)
    closeAfterDiscard.value = false
  }
  function cancelDiscard(): void {
    discardConfirmOpen.value = false
    closeAfterDiscard.value = false
  }
  async function save(): Promise<void> {
    if (!canSubmit.value) {
      errorMessage.value =
        validationError.value || roleErrorMessage.value || '没有权限保存用户。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      const refresh = editing.value?.id === session.user?.id
      if (isEdit.value && editing.value)
        await saveAdminUser({
          id: editing.value.id,
          displayName: form.displayName.trim(),
          roleIds: [...form.roleIds],
          revision: editing.value.revision,
        })
      else if (isCreate.value)
        await createAdminUser({
          username: form.username.trim(),
          displayName: form.displayName.trim(),
          password: form.password,
          roleIds: [...form.roleIds],
        })
      else return
      successMessage.value = isEdit.value ? '用户已保存。' : '用户已创建。'
      closeEditor(true)
      if (refresh) await session.restore({ force: true })
      await query()
    } catch (error) {
      errorMessage.value = isRevisionConflict(error)
        ? '用户详情已变化，请重新加载后再决定。'
        : getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }
  function requestChangeEnabled(row: AdminUser): void {
    if (!canChangeEnabled(row)) {
      errorMessage.value = isSystemUser(row)
        ? '系统用户由服务端维护，不能修改状态。'
        : row.id === session.user?.id
          ? '不能停用当前登录用户。'
          : '没有权限修改用户状态。'
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
      if (pending.kind === 'reset') {
        const result = await resetAdminUserPassword({
          id: pending.row.id,
          revision: pending.row.revision,
        })
        if (disposed.value) return
        pendingAction.value = null
        temporaryPassword.value = result.data.temporaryPassword
        passwordSaved.value = false
        await query()
        return
      }
      await setAdminUserEnabled(pending.row, pending.kind === 'enable')
      const success =
        pending.kind === 'enable' ? '用户已启用。' : '用户已停用。'
      pendingAction.value = null
      await query()
      successMessage.value = success
    } catch (error) {
      pendingAction.value = null
      const actionError = isRevisionConflict(error)
        ? '数据已更新，请根据最新状态重新操作。'
        : getErrorMessage(error)
      await query()
      errorMessage.value = actionError
    } finally {
      actionLoadingID.value = null
    }
  }
  function requestResetPassword(row: AdminUser): void {
    if (!canResetUserPassword(row)) {
      errorMessage.value = '该用户不符合重置密码条件。'
      return
    }
    pendingAction.value = { kind: 'reset', row }
  }
  async function copyTemporaryPassword(): Promise<void> {
    if (!temporaryPassword.value) return
    copyErrorMessage.value = null
    try {
      await navigator.clipboard.writeText(temporaryPassword.value)
    } catch {
      copyErrorMessage.value = '复制失败，请手动安全保存临时密码。'
    }
  }
  async function closeResetResult(): Promise<void> {
    if (!passwordSaved.value) return
    clearTemporaryPassword()
    await query()
  }
  return {
    rows,
    roles,
    total,
    page,
    pageSize,
    keyword,
    status,
    loading,
    saving,
    rolesLoading,
    errorMessage,
    queryErrorMessage,
    successMessage,
    roleErrorMessage,
    editorErrorMessage,
    editorOpen,
    editorMode,
    editing,
    form,
    pendingAction,
    actionLoadingID,
    temporaryPassword,
    passwordSaved,
    copyErrorMessage,
    discardConfirmOpen,
    isDetail,
    isSelf,
    rolesReadonly,
    hasUnsavedChanges,
    canCreate,
    canGet,
    canSave,
    canEdit,
    canEnable,
    canDisable,
    canResetPassword,
    passwordMinLength,
    isSystemUser,
    canEditUser,
    canViewUser,
    canChangeEnabled,
    canResetUserPassword,
    roleOptions,
    validationError,
    canSubmit,
    query,
    search,
    applyFilters,
    resetFilters,
    changePage,
    openCreate,
    openEdit,
    openDetail,
    closeEditor,
    confirmDiscard,
    cancelDiscard,
    save,
    requestChangeEnabled,
    confirmPendingAction,
    requestResetPassword,
    copyTemporaryPassword,
    closeResetResult,
    clearTemporaryPassword,
    retryRoles,
    retryEditor,
    dispose,
  }
}
export type UserManagementViewModel = ReturnType<
  typeof createUserManagementViewModel
>
