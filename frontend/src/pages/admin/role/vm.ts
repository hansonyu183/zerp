import { computed, reactive, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  createAdminRole,
  getAdminRole,
  queryAdminPermissions,
  queryAdminRoles,
  saveAdminRole,
  setAdminRoleEnabled,
  type AdminPermission,
  type AdminRole,
  type AdminStatus,
} from '../shared/api'

export interface PermissionEntityGroup {
  entity: string
  permissions: AdminPermission[]
}

export interface PermissionDomainGroup {
  domain: string
  entities: PermissionEntityGroup[]
}

export function createRoleManagementViewModel() {
  const session = useSessionStore()
  const rows = ref<AdminRole[]>([])
  const permissions = ref<AdminPermission[]>([])
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
  let editorLoadSequence = 0
  const editorOpen = ref(false)
  const editing = ref<AdminRole | null>(null)
  const form = reactive({
    code: '',
    name: '',
    description: '',
    permissionIds: [] as string[],
  })

  const canReadPermissions = computed(() =>
    session.can('/app/permission/query'),
  )
  const canGet = computed(() => session.can('/app/role/get'))
  const canCreate = computed(
    () => session.can('/app/role/create') && canReadPermissions.value,
  )
  const canSave = computed(() => session.can('/app/role/save'))
  const canEdit = computed(
    () => canGet.value && canSave.value && canReadPermissions.value,
  )
  const canEnable = computed(() => session.can('/app/role/enable'))
  const canDisable = computed(() => session.can('/app/role/disable'))
  const superadmin = computed(() => editing.value?.code === 'superadmin')

  function isSystemRole(row: AdminRole): boolean {
    return row.code === 'system'
  }

  function canEditRole(row: AdminRole): boolean {
    return !isSystemRole(row) && canEdit.value
  }

  function canChangeEnabled(row: AdminRole): boolean {
    if (isSystemRole(row)) return false
    return row.status === 'ENABLED' ? canDisable.value : canEnable.value
  }

  const permissionGroups = computed<PermissionDomainGroup[]>(() => {
    const domains = new Map<string, Map<string, AdminPermission[]>>()
    for (const permission of permissions.value) {
      const entities = domains.get(permission.domain) ?? new Map()
      const actions = entities.get(permission.entity) ?? []
      actions.push(permission)
      entities.set(permission.entity, actions)
      domains.set(permission.domain, entities)
    }
    return [...domains.entries()].map(([domain, entities]) => ({
      domain,
      entities: [...entities.entries()].map(([entity, actions]) => ({
        entity,
        permissions: actions.sort((left, right) =>
          left.path.localeCompare(right.path),
        ),
      })),
    }))
  })
  const selectedDisabledPermissions = computed(() =>
    permissions.value.filter(
      (permission) =>
        permission.status === 'DISABLED' &&
        form.permissionIds.includes(permission.id),
    ),
  )
  const hasOnlyEnabledSelectedPermissions = computed(
    () =>
      form.permissionIds.length > 0 &&
      form.permissionIds.every((permissionID) =>
        permissions.value.some(
          (permission) =>
            permission.id === permissionID && permission.status === 'ENABLED',
        ),
      ),
  )
  const validationError = computed(() => {
    if (!editing.value && !form.code.trim()) return '请输入角色编码。'
    if (!form.name.trim()) return '请输入角色名称。'
    if (!superadmin.value && form.permissionIds.length === 0) {
      return '请至少选择一个启用权限。'
    }
    if (!superadmin.value && selectedDisabledPermissions.value.length > 0) {
      return `已选权限包含已停用权限（${selectedDisabledPermissions.value.map((permission) => permission.path).join('、')}），请取消选择后再保存。`
    }
    if (!superadmin.value && !hasOnlyEnabledSelectedPermissions.value) {
      return '所选权限不存在或未启用，请取消选择后再保存。'
    }
    return ''
  })
  const canSubmit = computed(
    () =>
      !saving.value &&
      validationError.value === '' &&
      (editing.value ? canEditRole(editing.value) : canCreate.value),
  )

  async function query(): Promise<void> {
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const filters: Record<string, string> = {}
      if (keyword.value.trim()) filters.search = keyword.value.trim()
      if (status.value) filters.status = status.value
      const result = await queryAdminRoles({
        page: page.value,
        pageSize: pageSize.value,
        filters,
        sort: [{ field: 'code', order: 'asc' }],
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

  async function loadPermissions(): Promise<void> {
    const collected: AdminPermission[] = []
    let nextPage = 1
    let totalCount = 1
    while (collected.length < totalCount) {
      const result = await queryAdminPermissions({
        page: nextPage,
        pageSize: 200,
        sort: [{ field: 'path', order: 'asc' }],
      })
      collected.push(...result.data.items)
      totalCount = result.data.total
      nextPage += 1
      if (result.data.items.length === 0) break
    }
    permissions.value = collected
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
    form.code = ''
    form.name = ''
    form.description = ''
    form.permissionIds = []
  }

  async function openCreate(): Promise<void> {
    editorLoadSequence += 1
    loading.value = false
    editing.value = null
    resetForm()
    editorOpen.value = true
    try {
      await loadPermissions()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  async function openEdit(row: AdminRole): Promise<void> {
    if (!canEditRole(row)) {
      errorMessage.value = isSystemRole(row)
        ? '系统角色由服务端维护，不能编辑。'
        : '没有权限编辑角色。'
      return
    }
    const sequence = ++editorLoadSequence
    loading.value = true
    errorMessage.value = null
    try {
      const [detail] = await Promise.all([
        getAdminRole(row.id),
        loadPermissions(),
      ])
      if (sequence !== editorLoadSequence) return
      editing.value = detail.data
      form.code = detail.data.code
      form.name = detail.data.name
      form.description = detail.data.description ?? ''
      form.permissionIds = [...(detail.data.permissionIds ?? [])]
      editorOpen.value = true
    } catch (error) {
      if (sequence !== editorLoadSequence) return
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (sequence === editorLoadSequence) loading.value = false
    }
  }

  function closeEditor(): void {
    editorLoadSequence += 1
    loading.value = false
    editorOpen.value = false
    editing.value = null
    resetForm()
  }

  function permissionChecked(id: string): boolean {
    return form.permissionIds.includes(id)
  }

  function permissionDisabled(permission: AdminPermission): boolean {
    return (
      superadmin.value ||
      (permission.status === 'DISABLED' && !permissionChecked(permission.id))
    )
  }

  function permissionLabel(permission: AdminPermission): string {
    const label = permission.description || permission.path
    return permission.status === 'DISABLED' ? `${label}（已停用）` : label
  }

  function togglePermission(id: string, checked: boolean): void {
    if (superadmin.value) return
    const permission = permissions.value.find(
      (candidate) => candidate.id === id,
    )
    if (checked && permission?.status !== 'ENABLED') return
    form.permissionIds = checked
      ? [...new Set([...form.permissionIds, id])]
      : form.permissionIds.filter((permissionID) => permissionID !== id)
  }

  async function save(): Promise<void> {
    if (!canSubmit.value) {
      errorMessage.value = validationError.value || '没有权限保存角色。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      if (editing.value) {
        await saveAdminRole({
          id: editing.value.id,
          name: form.name.trim(),
          description: form.description.trim() || null,
          permissionIds: superadmin.value ? [] : [...form.permissionIds],
          revision: editing.value.revision,
        })
      } else {
        await createAdminRole({
          code: form.code.trim(),
          name: form.name.trim(),
          description: form.description.trim() || null,
          permissionIds: [...form.permissionIds],
        })
      }
      successMessage.value = editing.value ? '角色已保存。' : '角色已创建。'
      closeEditor()
      await session.restore({ force: true })
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function changeEnabled(row: AdminRole): Promise<void> {
    if (!canChangeEnabled(row)) {
      errorMessage.value = isSystemRole(row)
        ? '系统角色由服务端维护，不能修改状态。'
        : '没有权限修改角色状态。'
      return
    }
    loading.value = true
    errorMessage.value = null
    try {
      await setAdminRoleEnabled(row, row.status === 'DISABLED')
      successMessage.value =
        row.status === 'ENABLED' ? '角色已停用。' : '角色已启用。'
      await session.restore({ force: true })
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
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
    isSystemRole,
    canEditRole,
    canChangeEnabled,
    superadmin,
    permissionGroups,
    validationError,
    canSubmit,
    query,
    search,
    resetFilters,
    changePage,
    openCreate,
    openEdit,
    closeEditor,
    permissionChecked,
    permissionDisabled,
    permissionLabel,
    togglePermission,
    save,
    changeEnabled,
  }
}
