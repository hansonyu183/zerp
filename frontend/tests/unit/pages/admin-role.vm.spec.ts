import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/types'
import {
  createAdminRole,
  getAdminRole,
  queryAdminPermissions,
  queryAdminRoles,
  saveAdminRole,
  setAdminRoleEnabled,
} from '@/pages/app/shared/api'
import { createRoleManagementViewModel } from '@/pages/app/role/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/pages/app/shared/api', () => ({
  queryAdminRoles: vi.fn(),
  getAdminRole: vi.fn(),
  createAdminRole: vi.fn(),
  saveAdminRole: vi.fn(),
  setAdminRoleEnabled: vi.fn(),
  queryAdminPermissions: vi.fn(),
}))

const permission = {
  id: 'PERMISSION-1',
  path: '/app/user/get',
  domain: 'app',
  entity: 'user',
  action: 'get',
  description: '查看用户',
  status: 'ENABLED' as const,
  revision: 1,
  assignable: true,
}
const disabledPermission = {
  ...permission,
  id: 'PERMISSION-2',
  path: '/app/user/save',
  action: 'save',
  description: '修改用户',
  status: 'DISABLED' as const,
  assignable: false,
}
const role = {
  id: 'ROLE-1',
  code: 'ROL-0001',
  name: '查看员',
  description: null,
  status: 'ENABLED' as const,
  type: 'NORMAL' as const,
  availableActions: ['VIEW', 'EDIT', 'DISABLE'] as const,
  assignable: true,
  createdAt: '2026-08-05T00:00:00Z',
  updatedAt: '2026-08-05T00:00:00Z',
  revision: 3,
}
const detail = { ...role, permissions: [permission] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('role management view model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    const session = useSessionStore()
    session.permissions = [
      '/app/role/query',
      '/app/role/get',
      '/app/role/create',
      '/app/role/save',
      '/app/role/enable',
      '/app/role/disable',
      '/app/permission/query',
    ]
    vi.spyOn(session, 'restore').mockResolvedValue(true)
    vi.mocked(queryAdminRoles).mockResolvedValue({
      data: { items: [role], total: 1, page: 1, pageSize: 20 },
    })
    vi.mocked(getAdminRole).mockResolvedValue({ data: detail })
    vi.mocked(queryAdminPermissions).mockResolvedValue({
      data: { items: [permission], total: 1, page: 1, pageSize: 200 },
    })
    vi.mocked(createAdminRole).mockResolvedValue({ data: detail })
    vi.mocked(saveAdminRole).mockResolvedValue({ data: detail })
    vi.mocked(setAdminRoleEnabled).mockResolvedValue({ data: detail })
  })

  it('只在明确查询或应用时提交筛选草稿，并固定角色查询形状', async () => {
    const vm = createRoleManagementViewModel()
    vm.keyword.value = ' 查看 '
    vm.status.value = 'DISABLED'

    await vm.query()
    expect(queryAdminRoles).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      sort: [{ field: 'code', order: 'asc' }],
    })

    await vm.search()
    expect(queryAdminRoles).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      filters: { search: '查看' },
      sort: [{ field: 'code', order: 'asc' }],
    })

    await vm.applyFilters()
    expect(queryAdminRoles).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      filters: { search: '查看', status: 'DISABLED' },
      sort: [{ field: 'code', order: 'asc' }],
    })
  })

  it('拒绝旧查询覆盖新结果，失败时保留列表和可重试错误', async () => {
    const first = deferred<{
      data: { items: [typeof role]; total: number; page: number; pageSize: 20 }
    }>()
    const second = deferred<{
      data: { items: [typeof role]; total: number; page: number; pageSize: 20 }
    }>()
    vi.mocked(queryAdminRoles)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const vm = createRoleManagementViewModel()

    const older = vm.query()
    const newer = vm.query()
    second.resolve({
      data: {
        items: [{ ...role, id: 'ROLE-NEW' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await newer
    first.resolve({ data: { items: [role], total: 1, page: 1, pageSize: 20 } })
    await older
    expect(vm.rows.value[0]?.id).toBe('ROLE-NEW')

    vi.mocked(queryAdminRoles).mockRejectedValueOnce(new Error('offline'))
    await vm.query()
    expect(vm.rows.value[0]?.id).toBe('ROLE-NEW')
    expect(vm.queryErrorMessage.value).toContain('角色加载失败')
  })

  it('完全按服务端动作开放查看、编辑和状态入口', () => {
    const vm = createRoleManagementViewModel()
    expect(vm.canViewRole(role)).toBe(true)
    expect(vm.canEditRole(role)).toBe(true)
    expect(vm.canChangeEnabled(role)).toBe(true)
    expect(vm.rowActions(role).map((action) => action.label)).toEqual([
      '查看',
      '编辑',
      '停用',
    ])

    const readonly = { ...role, availableActions: ['VIEW'] as const }
    expect(vm.canViewRole(readonly)).toBe(true)
    expect(vm.canEditRole(readonly)).toBe(false)
    expect(vm.canChangeEnabled(readonly)).toBe(false)
  })

  it('只读详情不加载权限目录并展示服务端完整权限', async () => {
    const vm = createRoleManagementViewModel()
    await vm.openDetail(role)

    expect(getAdminRole).toHaveBeenCalledWith(role.id)
    expect(queryAdminPermissions).not.toHaveBeenCalled()
    expect(vm.editorMode.value).toBe('detail')
    expect(vm.editing.value?.permissions).toEqual([permission])
  })

  it('创建不接收角色编码，权限目录失败阻止提交，成功后刷新事实', async () => {
    const session = useSessionStore()
    const vm = createRoleManagementViewModel()
    await vm.openCreate()
    expect('code' in vm.form).toBe(false)
    vm.form.name = ' 新角色 '
    vm.togglePermission(permission.id, true)
    await vm.save()

    expect(createAdminRole).toHaveBeenCalledWith({
      name: '新角色',
      description: null,
      permissionIds: [permission.id],
    })
    expect(session.restore).toHaveBeenCalledWith({ force: true })
    expect(queryAdminRoles).toHaveBeenCalled()
    expect(vm.editorOpen.value).toBe(false)

    vi.mocked(queryAdminPermissions).mockRejectedValueOnce(new Error('down'))
    await vm.openCreate()
    expect(vm.permissionErrorMessage.value).toContain('权限目录加载失败')
    expect(vm.canSubmit.value).toBe(false)
  })

  it('编辑保留停用权限并要求显式移除，冲突保留全部输入', async () => {
    vi.mocked(getAdminRole).mockResolvedValueOnce({
      data: { ...detail, permissions: [permission, disabledPermission] },
    })
    vi.mocked(queryAdminPermissions).mockResolvedValueOnce({
      data: {
        items: [permission, disabledPermission],
        total: 2,
        page: 1,
        pageSize: 200,
      },
    })
    const vm = createRoleManagementViewModel()
    await vm.openEdit(role)
    expect(vm.form.permissionIds).toEqual([
      permission.id,
      disabledPermission.id,
    ])
    expect(vm.validationError.value).toContain('已停用权限')
    vm.togglePermission(disabledPermission.id, false)
    vm.form.name = '保留输入'
    vi.mocked(saveAdminRole).mockRejectedValueOnce(
      new ApiError('business', 'role revision conflict', { code: 3001 }),
    )
    await vm.save()

    expect(vm.editorOpen.value).toBe(true)
    expect(vm.form.name).toBe('保留输入')
    expect(vm.editorErrorMessage.value).toContain('重新加载')
  })

  it('编辑权限目录失败后重试会恢复表单并允许保存', async () => {
    vi.mocked(queryAdminPermissions)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({
        data: { items: [permission], total: 1, page: 1, pageSize: 200 },
      })
    const vm = createRoleManagementViewModel()

    await vm.openEdit(role)
    expect(vm.editorOpen.value).toBe(true)
    expect(vm.editorMode.value).toBe('edit')
    expect(vm.editing.value?.id).toBe(role.id)
    expect(vm.form.permissionIds).toEqual([permission.id])
    expect(vm.canSubmit.value).toBe(false)

    await vm.loadPermissions()
    expect(vm.permissionErrorMessage.value).toBeNull()
    expect(vm.canSubmit.value).toBe(true)
    await vm.save()
    expect(saveAdminRole).toHaveBeenCalledWith({
      id: role.id,
      name: role.name,
      description: null,
      permissionIds: [permission.id],
      revision: role.revision,
    })
  })

  it('仅将明确的并发变更显示为冲突，其他业务冲突使用中文映射', async () => {
    const vm = createRoleManagementViewModel()
    await vm.openCreate()
    vm.form.name = '重复角色'
    vm.togglePermission(permission.id, true)
    vi.mocked(createAdminRole).mockRejectedValueOnce(
      new ApiError('business', 'role name already exists', { code: 3001 }),
    )

    await vm.save()

    expect(vm.editorErrorMessage.value).toBe('角色名称已存在，请使用其他名称。')
  })

  it('所有脏表单离开入口共享同一放弃确认', async () => {
    const vm = createRoleManagementViewModel()
    await vm.openCreate()
    vm.form.name = '未保存'

    expect(vm.requestCloseEditor()).toBe(false)
    expect(vm.discardConfirmOpen.value).toBe(true)
    expect(vm.editorOpen.value).toBe(true)
    vm.cancelDiscard()
    expect(vm.requestRouteLeave()).toBe(false)
    vm.confirmDiscard()
    expect(vm.editorOpen.value).toBe(false)
  })

  it('状态确认使用明确即时授权文案、逐行锁和冲突事实刷新', async () => {
    const vm = createRoleManagementViewModel()
    vm.requestChangeEnabled(role)
    expect(vm.pendingAction.value?.kind).toBe('disable')
    expect(vm.pendingActionMessage.value).toContain('立即失去')
    const submit = vm.confirmPendingAction()
    expect(vm.actionLoadingID.value).toBe(role.id)
    await submit
    expect(vm.actionLoadingID.value).toBeNull()

    const disabled = {
      ...role,
      status: 'DISABLED' as const,
      availableActions: ['VIEW', 'ENABLE'] as const,
    }
    vm.requestChangeEnabled(disabled)
    expect(vm.pendingActionMessage.value).toContain('仍启用的权限')

    vi.mocked(setAdminRoleEnabled).mockRejectedValueOnce(
      new ApiError('business', 'role revision conflict', { code: 3001 }),
    )
    await vm.confirmPendingAction()
    expect(vm.errorMessage.value).toContain('重新发起')
    expect(queryAdminRoles).toHaveBeenCalled()
  })
})
