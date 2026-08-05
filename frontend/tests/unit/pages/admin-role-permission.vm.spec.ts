import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAdminRole,
  getAdminPermission,
  getAdminRole,
  queryAdminPermissions,
  queryAdminRoles,
  saveAdminRole,
  setAdminRoleEnabled,
} from '@/pages/admin/shared/api'
import { createPermissionManagementViewModel } from '@/pages/admin/permission/vm'
import { createRoleManagementViewModel } from '@/pages/admin/role/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/pages/admin/shared/api', () => ({
  queryAdminRoles: vi.fn(),
  getAdminRole: vi.fn(),
  createAdminRole: vi.fn(),
  saveAdminRole: vi.fn(),
  setAdminRoleEnabled: vi.fn(),
  queryAdminPermissions: vi.fn(),
  getAdminPermission: vi.fn(),
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
  roleCount: 2,
}
const disabledPermission = {
  ...permission,
  id: 'PERMISSION-2',
  path: '/app/user/save',
  action: 'save',
  description: '保存用户',
  status: 'DISABLED' as const,
}
const role = {
  id: 'ROLE-1',
  code: 'viewer',
  name: '查看员',
  description: null,
  status: 'ENABLED' as const,
  createdAt: '2026-08-05T00:00:00Z',
  updatedAt: '2026-08-05T00:00:00Z',
  revision: 3,
  permissionIds: ['PERMISSION-1'],
}
const systemRole = {
  ...role,
  id: 'ROLE-SYSTEM',
  code: 'system',
  name: '系统角色',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('role and permission management view models', () => {
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
      '/app/permission/get',
    ]
    vi.spyOn(session, 'restore').mockResolvedValue(true)
    vi.mocked(queryAdminRoles).mockResolvedValue({
      data: { items: [role], total: 1, page: 1, pageSize: 20 },
    })
    vi.mocked(getAdminRole).mockResolvedValue({ data: role })
    vi.mocked(queryAdminPermissions).mockResolvedValue({
      data: { items: [permission], total: 1, page: 1, pageSize: 200 },
    })
    vi.mocked(getAdminPermission).mockResolvedValue({ data: permission })
    vi.mocked(createAdminRole).mockResolvedValue({ data: role })
    vi.mocked(saveAdminRole).mockResolvedValue({ data: role })
    vi.mocked(setAdminRoleEnabled).mockResolvedValue({
      data: { ...role, status: 'DISABLED', revision: 4 },
    })
  })

  it('按领域、实体和动作形成只读权限树并允许独立授权', async () => {
    const vm = createRoleManagementViewModel()
    await vm.openCreate()

    expect(vm.permissionGroups.value).toEqual([
      {
        domain: 'app',
        entities: [{ entity: 'user', permissions: [permission] }],
      },
    ])
    vm.togglePermission('PERMISSION-1', true)
    vm.form.code = 'get-only'
    vm.form.name = '仅查看'
    await vm.save()

    expect(createAdminRole).toHaveBeenCalledWith({
      code: 'get-only',
      name: '仅查看',
      description: null,
      permissionIds: ['PERMISSION-1'],
    })
  })

  it('忽略乱序的旧角色查询响应且仅由最新请求结束加载状态', async () => {
    const first = deferred<{
      data: {
        items: (typeof role)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    const second = deferred<{
      data: {
        items: (typeof role)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    vi.mocked(queryAdminRoles)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const vm = createRoleManagementViewModel()

    vm.keyword.value = '旧查询'
    const olderQuery = vm.query()
    vm.keyword.value = '新查询'
    const newerQuery = vm.query()
    expect(vm.loading.value).toBe(true)

    second.resolve({
      data: {
        items: [{ ...role, id: 'ROLE-NEW' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await newerQuery
    expect(vm.rows.value).toEqual([{ ...role, id: 'ROLE-NEW' }])
    expect(vm.loading.value).toBe(false)

    first.resolve({
      data: {
        items: [{ ...role, id: 'ROLE-OLD' }],
        total: 99,
        page: 1,
        pageSize: 20,
      },
    })
    await olderQuery
    expect(vm.rows.value).toEqual([{ ...role, id: 'ROLE-NEW' }])
    expect(vm.total.value).toBe(1)
    expect(vm.loading.value).toBe(false)
  })

  it('角色保存使用完整权限集合并刷新当前会话', async () => {
    const session = useSessionStore()
    const vm = createRoleManagementViewModel()
    await vm.openEdit(role)
    vm.form.name = '更新查看员'
    await vm.save()

    expect(saveAdminRole).toHaveBeenCalledWith({
      id: 'ROLE-1',
      name: '更新查看员',
      description: null,
      permissionIds: ['PERMISSION-1'],
      revision: 3,
    })
    expect(session.restore).toHaveBeenCalledWith({ force: true })
  })

  it('已停用和未知权限阻止保存，移除已停用权限后可保存', async () => {
    const roleWithDisabledPermission = {
      ...role,
      permissionIds: [permission.id, disabledPermission.id],
    }
    vi.mocked(queryAdminPermissions).mockResolvedValue({
      data: {
        items: [permission, disabledPermission],
        total: 2,
        page: 1,
        pageSize: 200,
      },
    })
    vi.mocked(getAdminRole).mockResolvedValue({
      data: roleWithDisabledPermission,
    })
    const vm = createRoleManagementViewModel()

    await vm.openEdit(roleWithDisabledPermission)

    expect(queryAdminPermissions).toHaveBeenCalledWith({
      page: 1,
      pageSize: 200,
      sort: [{ field: 'path', order: 'asc' }],
    })
    expect(vm.permissionGroups.value[0]?.entities[0]?.permissions).toEqual([
      permission,
      disabledPermission,
    ])
    expect(vm.permissionDisabled(disabledPermission)).toBe(false)
    expect(vm.permissionLabel(disabledPermission)).toBe('保存用户（已停用）')
    expect(vm.validationError.value).toBe(
      '已选权限包含已停用权限（/app/user/save），请取消选择后再保存。',
    )
    await vm.save()
    expect(saveAdminRole).not.toHaveBeenCalled()

    vm.togglePermission(disabledPermission.id, false)
    expect(vm.validationError.value).toBe('')
    await vm.save()
    expect(saveAdminRole).toHaveBeenCalledWith({
      id: role.id,
      name: role.name,
      description: null,
      permissionIds: [permission.id],
      revision: role.revision,
    })

    await vm.openCreate()
    vm.form.code = 'get-only'
    vm.form.name = '仅查看'
    expect(vm.validationError.value).toBe('请至少选择一个启用权限。')
    expect(vm.permissionDisabled(disabledPermission)).toBe(true)
    vm.togglePermission(disabledPermission.id, true)
    expect(vm.form.permissionIds).toEqual([])
    vm.togglePermission(permission.id, true)
    vm.togglePermission(disabledPermission.id, true)
    expect(vm.form.permissionIds).toEqual([permission.id])

    vi.mocked(getAdminRole).mockResolvedValue({
      data: { ...role, permissionIds: ['PERMISSION-MISSING'] },
    })
    await vm.openEdit(role)
    expect(vm.validationError.value).toBe(
      '所选权限不存在或未启用，请取消选择后再保存。',
    )
    await vm.save()
    expect(saveAdminRole).toHaveBeenCalledTimes(1)
  })

  it('角色变更在刷新会话的 CSRF 后才查询列表', async () => {
    const session = useSessionStore()
    const calls: string[] = []
    vi.spyOn(session, 'restore').mockImplementation(async () => {
      calls.push('restore:start')
      await Promise.resolve()
      calls.push('restore:end')
      return true
    })
    vi.mocked(queryAdminRoles).mockImplementation(async () => {
      calls.push('query')
      return { data: { items: [role], total: 1, page: 1, pageSize: 20 } }
    })
    vi.mocked(createAdminRole).mockImplementation(async () => {
      calls.push('create')
      return { data: role }
    })
    vi.mocked(saveAdminRole).mockImplementation(async () => {
      calls.push('save')
      return { data: role }
    })
    vi.mocked(setAdminRoleEnabled).mockImplementation(async () => {
      calls.push('enabled')
      return { data: role }
    })
    const vm = createRoleManagementViewModel()

    await vm.openCreate()
    vm.form.code = 'get-only'
    vm.form.name = '仅查看'
    vm.togglePermission(permission.id, true)
    await vm.save()
    expect(calls).toEqual(['create', 'restore:start', 'restore:end', 'query'])

    calls.length = 0
    await vm.openEdit(role)
    vm.form.name = '更新查看员'
    await vm.save()
    expect(calls).toEqual(['save', 'restore:start', 'restore:end', 'query'])

    calls.length = 0
    await vm.changeEnabled(role)
    expect(calls).toEqual(['enabled', 'restore:start', 'restore:end', 'query'])

    calls.length = 0
    await vm.changeEnabled({ ...role, status: 'DISABLED' })
    expect(calls).toEqual(['enabled', 'restore:start', 'restore:end', 'query'])
  })

  it('角色创建和编辑包含权限目录与详情读取权限', () => {
    const session = useSessionStore()
    session.permissions = [
      '/app/role/query',
      '/app/role/get',
      '/app/role/create',
      '/app/role/save',
    ]
    const vm = createRoleManagementViewModel()

    expect(vm.canCreate.value).toBe(false)
    expect(vm.canEdit.value).toBe(false)

    session.permissions.push('/app/permission/query')
    expect(vm.canCreate.value).toBe(true)
    expect(vm.canEdit.value).toBe(true)

    session.permissions = session.permissions.filter(
      (permissionPath) => permissionPath !== '/app/role/get',
    )
    expect(vm.canEdit.value).toBe(false)
  })

  it('系统角色不提供编辑或启停操作，也不发起后端请求', async () => {
    const vm = createRoleManagementViewModel()

    expect(vm.isSystemRole(systemRole)).toBe(true)
    expect(vm.canEditRole(systemRole)).toBe(false)
    expect(vm.canChangeEnabled(systemRole)).toBe(false)
    expect(vm.canEditRole(role)).toBe(true)
    expect(vm.canChangeEnabled(role)).toBe(true)

    await vm.openEdit(systemRole)
    expect(getAdminRole).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe('系统角色由服务端维护，不能编辑。')

    await vm.changeEnabled(systemRole)
    expect(setAdminRoleEnabled).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe('系统角色由服务端维护，不能修改状态。')
  })

  it('权限目录只支持筛选和详情读取', async () => {
    const vm = createPermissionManagementViewModel()
    vm.domain.value = 'app'
    vm.entity.value = 'user'
    vm.status.value = 'ENABLED'
    await vm.query()
    await vm.openDetail(permission)

    expect(queryAdminPermissions).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      filters: { domain: 'app', entity: 'user', status: 'ENABLED' },
      sort: [{ field: 'path', order: 'asc' }],
    })
    expect(getAdminPermission).toHaveBeenCalledWith('PERMISSION-1')
    expect(vm.detail.value).toEqual(permission)
  })

  it('忽略乱序的旧权限查询响应和错误', async () => {
    const first = deferred<{
      data: {
        items: (typeof permission)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    const second = deferred<{
      data: {
        items: (typeof permission)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    vi.mocked(queryAdminPermissions)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const vm = createPermissionManagementViewModel()

    vm.domain.value = '旧领域'
    const olderQuery = vm.query()
    vm.domain.value = '新领域'
    const newerQuery = vm.query()
    expect(vm.loading.value).toBe(true)

    second.resolve({
      data: {
        items: [{ ...permission, id: 'PERMISSION-NEW' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await newerQuery
    expect(vm.rows.value).toEqual([{ ...permission, id: 'PERMISSION-NEW' }])
    expect(vm.loading.value).toBe(false)

    first.reject(new Error('旧查询失败'))
    await olderQuery
    expect(vm.rows.value).toEqual([{ ...permission, id: 'PERMISSION-NEW' }])
    expect(vm.total.value).toBe(1)
    expect(vm.errorMessage.value).toBeNull()
    expect(vm.loading.value).toBe(false)
  })

  it('权限详情操作只在授予 get 权限时可用', () => {
    const session = useSessionStore()
    session.permissions = ['/app/permission/query']
    const vm = createPermissionManagementViewModel()

    expect(vm.canGet.value).toBe(false)
    session.permissions.push('/app/permission/get')
    expect(vm.canGet.value).toBe(true)
  })
})
