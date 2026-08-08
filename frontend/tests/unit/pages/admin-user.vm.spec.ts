import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAdminUser,
  getAdminUser,
  queryAdminRoles,
  queryAdminUsers,
  saveAdminUser,
  setAdminUserEnabled,
} from '@/pages/admin/shared/api'
import { createUserManagementViewModel } from '@/pages/admin/user/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/pages/admin/shared/api', () => ({
  queryAdminUsers: vi.fn(),
  getAdminUser: vi.fn(),
  createAdminUser: vi.fn(),
  saveAdminUser: vi.fn(),
  setAdminUserEnabled: vi.fn(),
  queryAdminRoles: vi.fn(),
}))

const user = {
  id: 'USER-1',
  username: 'operator',
  displayName: '操作员',
  status: 'ENABLED' as const,
  failedSigninCount: 0,
  passwordChangedAt: '2026-08-05T00:00:00Z',
  createdAt: '2026-08-05T00:00:00Z',
  updatedAt: '2026-08-05T00:00:00Z',
  revision: 2,
  roleIds: ['ROLE-1'],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('user management view model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    const session = useSessionStore()
    session.permissions = [
      '/app/user/query',
      '/app/user/get',
      '/app/user/create',
      '/app/user/save',
      '/app/user/enable',
      '/app/user/disable',
      '/app/role/query',
    ]
    vi.mocked(queryAdminUsers).mockResolvedValue({
      data: { items: [user], total: 1, page: 1, pageSize: 20 },
    })
    vi.mocked(queryAdminRoles).mockResolvedValue({
      data: {
        items: [
          {
            id: 'ROLE-1',
            code: 'operator',
            name: '操作员',
            status: 'ENABLED',
            createdAt: '2026-08-05T00:00:00Z',
            updatedAt: '2026-08-05T00:00:00Z',
            revision: 1,
          },
          {
            id: 'ROLE-2',
            code: 'reviewer',
            name: '审核员',
            status: 'ENABLED',
            createdAt: '2026-08-05T00:00:00Z',
            updatedAt: '2026-08-05T00:00:00Z',
            revision: 1,
          },
        ],
        total: 2,
        page: 1,
        pageSize: 200,
      },
    })
    vi.mocked(getAdminUser).mockResolvedValue({ data: user })
    vi.mocked(createAdminUser).mockResolvedValue({ data: user })
    vi.mocked(saveAdminUser).mockResolvedValue({ data: user })
    vi.mocked(setAdminUserEnabled).mockResolvedValue({
      data: { ...user, status: 'DISABLED', revision: 3 },
    })
  })

  it('按搜索和状态查询且不接触敏感字段', async () => {
    const vm = createUserManagementViewModel()
    vm.keyword.value = 'operator'
    vm.status.value = 'ENABLED'

    await vm.query()

    expect(queryAdminUsers).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      filters: { search: 'operator', status: 'ENABLED' },
      sort: [{ field: 'username', order: 'asc' }],
    })
    expect(vm.rows.value).toEqual([user])
    expect(vm.rows.value[0]).not.toHaveProperty('passwordHash')
    expect(vm.rows.value[0]).not.toHaveProperty('sessionToken')
  })

  it('忽略乱序的旧查询响应且仅由最新请求结束加载状态', async () => {
    const first = deferred<{
      data: {
        items: (typeof user)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    const second = deferred<{
      data: {
        items: (typeof user)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    vi.mocked(queryAdminUsers)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const vm = createUserManagementViewModel()

    vm.keyword.value = '旧查询'
    const olderQuery = vm.query()
    vm.keyword.value = '新查询'
    const newerQuery = vm.query()
    expect(vm.loading.value).toBe(true)

    second.resolve({
      data: {
        items: [{ ...user, id: 'USER-NEW' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await newerQuery
    expect(vm.rows.value).toEqual([{ ...user, id: 'USER-NEW' }])
    expect(vm.loading.value).toBe(false)

    first.resolve({
      data: {
        items: [{ ...user, id: 'USER-OLD' }],
        total: 99,
        page: 1,
        pageSize: 20,
      },
    })
    await olderQuery
    expect(vm.rows.value).toEqual([{ ...user, id: 'USER-NEW' }])
    expect(vm.total.value).toBe(1)
    expect(vm.loading.value).toBe(false)
  })

  it('创建用户时提交角色并保留密码只在创建请求中', async () => {
    const vm = createUserManagementViewModel()
    await vm.openCreate()
    vm.form.username = 'new-user'
    vm.form.displayName = '新用户'
    vm.form.password = 'Strong-password-1!'
    vm.form.roleIds = ['ROLE-1']

    await vm.save()

    expect(createAdminUser).toHaveBeenCalledWith({
      username: 'new-user',
      displayName: '新用户',
      password: 'Strong-password-1!',
      roleIds: ['ROLE-1'],
    })
    expect(vm.form.password).toBe('')
  })

  it('分页加载全部角色并保留后续页角色的选择标签', async () => {
    const firstPageRoles = Array.from({ length: 200 }, (_, index) => ({
      id: `ROLE-${index + 1}`,
      code: `role-${String(index + 1).padStart(3, '0')}`,
      name: `角色 ${index + 1}`,
      status: 'ENABLED' as const,
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z',
      revision: 1,
    }))
    const lastRole = {
      id: 'ROLE-201',
      code: 'role-201',
      name: '角色 201',
      status: 'ENABLED' as const,
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z',
      revision: 1,
    }
    vi.mocked(queryAdminRoles)
      .mockResolvedValueOnce({
        data: { items: firstPageRoles, total: 201, page: 1, pageSize: 200 },
      })
      .mockResolvedValueOnce({
        data: { items: [lastRole], total: 201, page: 2, pageSize: 200 },
      })
    const vm = createUserManagementViewModel()

    await vm.openCreate()
    vm.form.roleIds = [lastRole.id]

    expect(queryAdminRoles).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 200,
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(queryAdminRoles).toHaveBeenNthCalledWith(2, {
      page: 2,
      pageSize: 200,
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(vm.roleOptions.value).toContainEqual({
      title: 'role-201 · 角色 201',
      value: 'ROLE-201',
      disabled: false,
    })
  })

  it('不将内置系统角色作为可分配角色，保留已禁用角色策略', async () => {
    const systemRole = {
      id: 'ROLE-SYSTEM',
      code: 'system',
      name: '系统角色',
      status: 'ENABLED' as const,
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z',
      revision: 1,
    }
    const disabledRole = {
      id: 'ROLE-DISABLED',
      code: 'disabled',
      name: '已停用角色',
      status: 'DISABLED' as const,
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z',
      revision: 1,
    }
    vi.mocked(queryAdminRoles).mockResolvedValue({
      data: {
        items: [systemRole, disabledRole],
        total: 2,
        page: 1,
        pageSize: 200,
      },
    })
    const vm = createUserManagementViewModel()

    await vm.openCreate()

    expect(vm.roles.value).toEqual([disabledRole])
    expect(vm.roleOptions.value).toEqual([
      {
        title: 'disabled · 已停用角色（已停用）',
        value: 'ROLE-DISABLED',
        disabled: true,
      },
    ])
  })

  it('编辑时保留已停用角色标签，但要求移除后才能保存', async () => {
    const enabledRole = {
      id: 'ROLE-ENABLED',
      code: 'enabled',
      name: '启用角色',
      status: 'ENABLED' as const,
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z',
      revision: 1,
    }
    const disabledRole = {
      id: 'ROLE-DISABLED',
      code: 'disabled',
      name: '已停用角色',
      status: 'DISABLED' as const,
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z',
      revision: 1,
    }
    const userWithDisabledRole = { ...user, roleIds: [disabledRole.id] }
    vi.mocked(queryAdminRoles).mockResolvedValue({
      data: {
        items: [enabledRole, disabledRole],
        total: 2,
        page: 1,
        pageSize: 200,
      },
    })
    vi.mocked(getAdminUser).mockResolvedValue({ data: userWithDisabledRole })
    const vm = createUserManagementViewModel()

    await vm.openEdit(userWithDisabledRole)

    expect(vm.roleOptions.value).toContainEqual({
      title: 'disabled · 已停用角色（已停用）',
      value: disabledRole.id,
      disabled: false,
    })
    expect(vm.validationError.value).toBe(
      '已选角色包含已停用角色（已停用角色），请移除后再保存。',
    )
    expect(vm.canSubmit.value).toBe(false)
    await vm.save()
    expect(saveAdminUser).not.toHaveBeenCalled()

    vm.form.roleIds = [enabledRole.id]
    expect(vm.validationError.value).toBe('')
    await vm.save()
    expect(saveAdminUser).toHaveBeenCalledWith({
      id: userWithDisabledRole.id,
      displayName: userWithDisabledRole.displayName,
      roleIds: [enabledRole.id],
      revision: userWithDisabledRole.revision,
    })

    await vm.openCreate()
    vm.form.username = 'new-user'
    vm.form.displayName = '新用户'
    vm.form.password = 'Strong-password-1!'
    vm.form.roleIds = [disabledRole.id]
    expect(vm.validationError.value).toBe(
      '已选角色包含已停用角色（已停用角色），请移除后再保存。',
    )
    await vm.save()
    expect(createAdminUser).not.toHaveBeenCalled()

    vm.form.roleIds = ['ROLE-MISSING']
    expect(vm.validationError.value).toBe(
      '所选角色不存在或未启用，请重新选择。',
    )

    vm.form.roleIds = []
    expect(vm.validationError.value).toBe('请至少选择一个启用角色。')
  })

  it('当前登录用户保存后先刷新会话再查询列表', async () => {
    const session = useSessionStore()
    const calls: string[] = []
    session.user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    }
    vi.spyOn(session, 'restore').mockImplementation(async () => {
      calls.push('restore:start')
      await Promise.resolve()
      calls.push('restore:end')
      return true
    })
    vi.mocked(queryAdminUsers).mockImplementation(async () => {
      calls.push('query')
      return { data: { items: [user], total: 1, page: 1, pageSize: 20 } }
    })
    vi.mocked(saveAdminUser).mockImplementation(async () => {
      calls.push('save')
      return { data: user }
    })
    vi.mocked(createAdminUser).mockImplementation(async () => {
      calls.push('create')
      return { data: user }
    })
    const vm = createUserManagementViewModel()

    await vm.openEdit(user)
    vm.form.roleIds = ['ROLE-2']
    await vm.save()
    expect(calls).toEqual(['save', 'restore:start', 'restore:end', 'query'])

    calls.length = 0
    await vm.openEdit(user)
    vm.form.displayName = '更新名称'
    await vm.save()
    expect(calls).toEqual(['save', 'restore:start', 'restore:end', 'query'])

    calls.length = 0
    const otherUser = { ...user, id: 'USER-2' }
    vi.mocked(getAdminUser).mockResolvedValueOnce({ data: otherUser })
    await vm.openEdit(otherUser)
    await vm.save()
    expect(calls).toEqual(['save', 'query'])

    calls.length = 0
    await vm.openCreate()
    vm.form.username = 'new-user'
    vm.form.displayName = '新用户'
    vm.form.password = 'Strong-password-1!'
    vm.form.roleIds = ['ROLE-1']
    await vm.save()
    expect(calls).toEqual(['create', 'query'])
  })

  it('创建和编辑操作包含流程依赖的读取权限', () => {
    const session = useSessionStore()
    session.permissions = [
      '/app/user/query',
      '/app/user/create',
      '/app/user/save',
    ]
    const vm = createUserManagementViewModel()

    expect(vm.canCreate.value).toBe(false)
    expect(vm.canEdit.value).toBe(false)

    session.permissions.push('/app/role/query')
    expect(vm.canCreate.value).toBe(true)
    expect(vm.canEdit.value).toBe(false)

    session.permissions.push('/app/user/get')
    expect(vm.canEdit.value).toBe(true)
  })

  it('编辑使用详情 revision，启停使用列表当前 revision', async () => {
    const vm = createUserManagementViewModel()
    await vm.openEdit(user)
    vm.form.displayName = '更新名称'
    await vm.save()

    expect(saveAdminUser).toHaveBeenCalledWith({
      id: 'USER-1',
      displayName: '更新名称',
      roleIds: ['ROLE-1'],
      revision: 2,
    })

    await vm.changeEnabled(user)
    expect(setAdminUserEnabled).toHaveBeenCalledWith(user, false)
  })

  it('阻止当前登录用户停用自己且不发送状态请求', async () => {
    const session = useSessionStore()
    session.user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    }
    const vm = createUserManagementViewModel()

    expect(vm.canChangeEnabled(user)).toBe(false)
    await vm.changeEnabled(user)

    expect(setAdminUserEnabled).not.toHaveBeenCalled()
    expect(queryAdminUsers).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe('不能停用当前登录用户。')
    expect(vm.canChangeEnabled({ ...user, id: 'USER-2' })).toBe(true)
    expect(vm.canChangeEnabled({ ...user, status: 'DISABLED' })).toBe(true)
  })

  it('系统用户不提供编辑或启停操作，也不发起后端请求', async () => {
    const systemUser = {
      ...user,
      id: 'USER-SYSTEM',
      username: 'system',
      displayName: '系统用户',
      status: 'DISABLED' as const,
    }
    const vm = createUserManagementViewModel()

    expect(vm.isSystemUser(systemUser)).toBe(true)
    expect(vm.canEditUser(systemUser)).toBe(false)
    expect(vm.canChangeEnabled(systemUser)).toBe(false)
    expect(vm.canEditUser(user)).toBe(true)

    await vm.openEdit(systemUser)
    expect(getAdminUser).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe('系统用户由服务端维护，不能编辑。')

    await vm.changeEnabled(systemUser)
    expect(setAdminUserEnabled).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe('系统用户由服务端维护，不能修改状态。')
  })
})
