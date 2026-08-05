import { computed, reactive, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  createAdminUser,
  getAdminUser,
  queryAdminRoles,
  queryAdminUsers,
  saveAdminUser,
  setAdminUserEnabled,
  type AdminRole,
  type AdminStatus,
  type AdminUser,
} from '../shared/api'

export function createUserManagementViewModel() {
  const session = useSessionStore()
  const rows = ref<AdminUser[]>([])
  const roles = ref<AdminRole[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const status = ref<AdminStatus | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  let querySequence = 0
  const editorOpen = ref(false)
  const editing = ref<AdminUser | null>(null)
  const form = reactive({
    username: '',
    displayName: '',
    password: '',
    roleIds: [] as string[],
  })

  const canReadRoles = computed(() => session.can('/app/role/query'))
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

  function isSystemUser(row: AdminUser): boolean {
    return row.username === 'system'
  }

  function canEditUser(row: AdminUser): boolean {
    return !isSystemUser(row) && canEdit.value
  }

  function canChangeEnabled(row: AdminUser): boolean {
    if (isSystemUser(row)) return false
    if (row.status === 'ENABLED' && row.id === session.user?.id) return false
    return row.status === 'ENABLED' ? canDisable.value : canEnable.value
  }
  const roleOptions = computed(() =>
    roles.value.map((role) => ({
      title: `${role.code} · ${role.name}${role.status === 'DISABLED' ? '（已停用）' : ''}`,
      value: role.id,
      disabled: role.status === 'DISABLED' && !form.roleIds.includes(role.id),
    })),
  )
  const selectedDisabledRoles = computed(() =>
    roles.value.filter(
      (role) => role.status === 'DISABLED' && form.roleIds.includes(role.id),
    ),
  )
  const hasOnlyEnabledSelectedRoles = computed(
    () =>
      form.roleIds.length > 0 &&
      form.roleIds.every((roleID) =>
        roles.value.some(
          (role) => role.id === roleID && role.status === 'ENABLED',
        ),
      ),
  )
  const validationError = computed(() => {
    if (!editing.value && !form.username.trim()) return '请输入用户名。'
    if (!form.displayName.trim()) return '请输入显示名称。'
    if (!editing.value && !form.password) return '请输入初始密码。'
    if (form.roleIds.length === 0) return '请至少选择一个启用角色。'
    if (selectedDisabledRoles.value.length > 0) {
      return `已选角色包含已停用角色（${selectedDisabledRoles.value.map((role) => role.name).join('、')}），请移除后再保存。`
    }
    if (!hasOnlyEnabledSelectedRoles.value) {
      return '所选角色不存在或未启用，请重新选择。'
    }
    return ''
  })
  const canSubmit = computed(
    () =>
      !saving.value &&
      validationError.value === '' &&
      (editing.value ? canEdit.value : canCreate.value),
  )

  async function query(): Promise<void> {
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const filters: Record<string, string> = {}
      if (keyword.value.trim()) filters.search = keyword.value.trim()
      if (status.value) filters.status = status.value
      const result = await queryAdminUsers({
        page: page.value,
        pageSize: pageSize.value,
        filters,
        sort: [{ field: 'username', order: 'asc' }],
      })
      if (sequence !== querySequence) return
      rows.value = result.data.items
      total.value = result.data.total
    } catch (error) {
      if (sequence !== querySequence) return
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (sequence === querySequence) loading.value = false
    }
  }

  async function loadRoles(): Promise<void> {
    try {
      const collected: AdminRole[] = []
      let nextPage = 1
      let totalCount = 1
      while (collected.length < totalCount) {
        const result = await queryAdminRoles({
          page: nextPage,
          pageSize: 200,
          sort: [{ field: 'code', order: 'asc' }],
        })
        collected.push(...result.data.items)
        totalCount = result.data.total
        nextPage += 1
        if (result.data.items.length === 0) break
      }
      roles.value = collected.filter((role) => role.code !== 'system')
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    keyword.value = ''
    status.value = null
    await search()
  }

  async function changePage(next: number): Promise<void> {
    if (next < 1 || next === page.value || loading.value) return
    page.value = next
    await query()
  }

  function resetForm(): void {
    form.username = ''
    form.displayName = ''
    form.password = ''
    form.roleIds = []
  }

  async function openCreate(): Promise<void> {
    editing.value = null
    resetForm()
    editorOpen.value = true
    await loadRoles()
  }

  async function openEdit(row: AdminUser): Promise<void> {
    if (!canEditUser(row)) {
      errorMessage.value = isSystemUser(row)
        ? '系统用户由服务端维护，不能编辑。'
        : '没有权限编辑用户。'
      return
    }
    loading.value = true
    errorMessage.value = null
    try {
      const [detail] = await Promise.all([getAdminUser(row.id), loadRoles()])
      editing.value = detail.data
      form.username = detail.data.username
      form.displayName = detail.data.displayName
      form.password = ''
      form.roleIds = [...(detail.data.roleIds ?? [])]
      editorOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function closeEditor(): void {
    editorOpen.value = false
    editing.value = null
    resetForm()
  }

  async function save(): Promise<void> {
    if (!canSubmit.value) {
      errorMessage.value = validationError.value || '没有权限保存用户。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      const refreshCurrentSession =
        editing.value !== null && editing.value.id === session.user?.id
      if (editing.value) {
        await saveAdminUser({
          id: editing.value.id,
          displayName: form.displayName.trim(),
          roleIds: [...form.roleIds],
          revision: editing.value.revision,
        })
      } else {
        await createAdminUser({
          username: form.username.trim(),
          displayName: form.displayName.trim(),
          password: form.password,
          roleIds: [...form.roleIds],
        })
      }
      successMessage.value = editing.value ? '用户已保存。' : '用户已创建。'
      closeEditor()
      if (refreshCurrentSession) await session.restore({ force: true })
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function changeEnabled(row: AdminUser): Promise<void> {
    if (!canChangeEnabled(row)) {
      errorMessage.value = isSystemUser(row)
        ? '系统用户由服务端维护，不能修改状态。'
        : row.status === 'ENABLED' && row.id === session.user?.id
          ? '不能停用当前登录用户。'
          : '没有权限修改用户状态。'
      return
    }
    loading.value = true
    errorMessage.value = null
    try {
      await setAdminUserEnabled(row, row.status === 'DISABLED')
      successMessage.value =
        row.status === 'ENABLED' ? '用户已停用。' : '用户已启用。'
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
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
    errorMessage,
    successMessage,
    editorOpen,
    editing,
    form,
    canCreate,
    canGet,
    canSave,
    canEdit,
    canEnable,
    canDisable,
    isSystemUser,
    canEditUser,
    canChangeEnabled,
    roleOptions,
    validationError,
    canSubmit,
    query,
    search,
    resetFilters,
    changePage,
    openCreate,
    openEdit,
    closeEditor,
    save,
    changeEnabled,
  }
}

export type UserManagementViewModel = ReturnType<
  typeof createUserManagementViewModel
>
