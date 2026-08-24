import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAdminUser,
  getAdminUser,
  queryAdminRoles,
  queryAdminUsers,
  saveAdminUser,
  setAdminUserEnabled,
  resetAdminUserPassword,
} from '@/pages/app/shared/api'
import { createUserManagementViewModel } from '@/pages/app/user/vm'
import { useSessionStore } from '@/stores/session'
import { ApiError } from '@/api/types'

vi.mock('@/pages/app/shared/api', () => ({
  queryAdminUsers: vi.fn(),
  getAdminUser: vi.fn(),
  createAdminUser: vi.fn(),
  saveAdminUser: vi.fn(),
  setAdminUserEnabled: vi.fn(),
  resetAdminUserPassword: vi.fn(),
  queryAdminRoles: vi.fn(),
}))

const user = {
  id: 'USER-1',
  username: 'operator',
  displayName: '操作员',
  status: 'ENABLED' as const,
  system: false,
  createdAt: '2026-08-05T00:00:00Z',
  updatedAt: '2026-08-05T00:00:00Z',
  revision: 2,
  passwordChangedAt: '2026-08-05T00:00:00Z',
  manageable: true,
  roleAssignmentEditable: true,
  roles: [
    {
      id: 'ROLE-1',
      code: 'operator',
      name: '操作员',
      status: 'ENABLED' as const,
      type: 'NORMAL' as const,
      assignable: true,
    },
  ],
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
          { ...roleListItem('ROLE-1', 'operator', '操作员'), assignable: true },
          { ...roleListItem('ROLE-2', 'reviewer', '审核员'), assignable: true },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      },
    })
    vi.mocked(getAdminUser).mockResolvedValue({ data: user })
    vi.mocked(createAdminUser).mockResolvedValue({ data: user })
    vi.mocked(saveAdminUser).mockResolvedValue({ data: user })
    vi.mocked(resetAdminUserPassword).mockResolvedValue({
      data: { temporaryPassword: 'temporary-value' },
    })
    vi.mocked(setAdminUserEnabled).mockResolvedValue({
      data: { ...user, status: 'DISABLED', revision: 3 },
    })
  })

  it('按搜索和状态查询且不接触敏感字段', async () => {
    const vm = createUserManagementViewModel()
    vm.keyword.value = 'operator'
    vm.status.value = 'ENABLED'

    await vm.search()
    await vm.applyFilters()

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

  it('关键词查询不会提前应用状态草稿，状态只在应用筛选后请求', async () => {
    const vm = createUserManagementViewModel()
    vm.page.value = 2
    vm.keyword.value = 'operator'
    vm.status.value = 'ENABLED'

    await vm.search()

    expect(queryAdminUsers).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      filters: { search: 'operator' },
      sort: [{ field: 'username', order: 'asc' }],
    })

    vm.page.value = 2
    vm.keyword.value = '尚未查询的关键词'
    await vm.applyFilters()

    expect(queryAdminUsers).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      filters: { search: 'operator', status: 'ENABLED' },
      sort: [{ field: 'username', order: 'asc' }],
    })
  })

  it('查询失败保留上下文和持久失败状态，成功空结果才清除失败状态', async () => {
    vi.mocked(queryAdminUsers)
      .mockResolvedValueOnce({
        data: { items: [user], total: 1, page: 1, pageSize: 20 },
      })
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = createUserManagementViewModel()

    vm.status.value = 'ENABLED'
    await vm.applyFilters()
    vm.keyword.value = '保留筛选'
    await vm.search()

    expect(vm.rows.value).toEqual([user])
    expect(vm.total.value).toBe(1)
    expect(vm.keyword.value).toBe('保留筛选')
    expect(vm.status.value).toBe('ENABLED')
    expect(vm.queryErrorMessage.value).toContain('用户加载失败')
    vm.errorMessage.value = null
    expect(vm.queryErrorMessage.value).toContain('用户加载失败')

    vm.keyword.value = ''
    vm.status.value = null
    await vm.resetFilters()

    expect(vm.queryErrorMessage.value).toBeNull()
    expect(vm.rows.value).toEqual([])
    expect(vm.total.value).toBe(0)
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
    const olderQuery = vm.search()
    vm.keyword.value = '新查询'
    const newerQuery = vm.search()
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

  it('并发删除导致页码越界时回到最后一个有效页而不显示真实空态', async () => {
    vi.mocked(queryAdminUsers)
      .mockResolvedValueOnce({
        data: { items: [], total: 1, page: 2, pageSize: 20 },
      })
      .mockResolvedValueOnce({
        data: { items: [user], total: 1, page: 1, pageSize: 20 },
      })
    const vm = createUserManagementViewModel()
    vm.page.value = 2

    await vm.query()

    expect(queryAdminUsers).toHaveBeenCalledTimes(2)
    expect(vm.page.value).toBe(1)
    expect(vm.rows.value).toEqual([user])
  })

  it('忽略乱序的旧用户编辑详情响应', async () => {
    const first = deferred<{ data: typeof user }>()
    const second = deferred<{ data: typeof user }>()
    const otherUser = {
      ...user,
      id: 'USER-2',
      username: 'reviewer',
      displayName: '审核员',
      revision: 4,
      roles: [
        {
          id: 'ROLE-2',
          code: 'reviewer',
          name: '审核员',
          status: 'ENABLED' as const,
          type: 'NORMAL' as const,
          assignable: true,
        },
      ],
    }
    vi.mocked(getAdminUser)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const vm = createUserManagementViewModel()

    const firstLoad = vm.openEdit(user)
    const secondLoad = vm.openEdit(otherUser)
    second.resolve({ data: otherUser })
    await secondLoad
    expect(vm.editing.value).toEqual(otherUser)
    expect(vm.form.displayName).toBe('审核员')

    first.resolve({ data: user })
    await firstLoad
    expect(vm.editing.value).toEqual(otherUser)
    expect(vm.form.displayName).toBe('审核员')
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

  it('创建用户基础字段校验与服务端长度边界一致', async () => {
    const vm = createUserManagementViewModel()
    await vm.openCreate()
    vm.form.roleIds = ['ROLE-1']
    vm.form.displayName = '新用户'
    vm.form.password = 'Strong-password-1!'

    vm.form.username = 'ab'
    expect(vm.validationError.value).toBe('用户名应为 3 至 64 个字符。')
    vm.form.username = 'new-user'
    vm.form.displayName = '名'.repeat(129)
    expect(vm.validationError.value).toBe('显示名称应为 1 至 128 个字符。')
    vm.form.displayName = '新用户'
    vm.form.password = `Aa1!${'x'.repeat(253)}`
    expect(vm.validationError.value).toBe(
      '初始密码应为 12 至 256 个字符，且包含大小写字母、数字和符号。',
    )
  })

  it('分页加载全部角色并保留后续页角色的选择标签', async () => {
    const firstPageRoles = Array.from({ length: 20 }, (_, index) => ({
      ...roleListItem(
        `ROLE-${index + 1}`,
        `role-${String(index + 1).padStart(3, '0')}`,
        `角色 ${index + 1}`,
      ),
      assignable: true,
    }))
    const lastRole = {
      ...roleListItem('ROLE-21', 'role-021', '角色 21'),
      assignable: true,
    }
    vi.mocked(queryAdminRoles)
      .mockResolvedValueOnce({
        data: { items: firstPageRoles, total: 21, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({
        data: { items: [lastRole], total: 21, page: 2, pageSize: 20 },
      })
    const vm = createUserManagementViewModel()

    await vm.openCreate()
    vm.form.roleIds = [lastRole.id]

    expect(queryAdminRoles).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 20,
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(queryAdminRoles).toHaveBeenNthCalledWith(2, {
      page: 2,
      pageSize: 20,
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(vm.roleOptions.value).toContainEqual({
      title: 'role-021 · 角色 21',
      value: 'ROLE-21',
      props: { disabled: false, 'aria-disabled': undefined },
    })
  })

  it('不将内置系统角色作为可分配角色，保留已禁用角色策略', async () => {
    const systemRole = {
      ...roleListItem('ROLE-SYSTEM', 'system', '系统角色'),
      type: 'SYSTEM' as const,
    }
    const disabledRole = {
      ...roleListItem('ROLE-DISABLED', 'disabled', '已停用角色'),
      status: 'DISABLED' as const,
    }
    vi.mocked(queryAdminRoles).mockResolvedValue({
      data: {
        items: [systemRole, disabledRole],
        total: 2,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = createUserManagementViewModel()

    await vm.openCreate()

    expect(vm.roles.value).toEqual([disabledRole])
    expect(vm.roleOptions.value).toEqual([])
  })

  it('编辑时保留已停用角色标签，但要求移除后才能保存', async () => {
    const enabledRole = {
      ...roleListItem('ROLE-ENABLED', 'enabled', '启用角色'),
      assignable: true,
    }
    const disabledRole = {
      ...roleListItem('ROLE-DISABLED', 'disabled', '已停用角色'),
      status: 'DISABLED' as const,
    }
    const userWithDisabledRole = {
      ...user,
      roles: [
        {
          id: disabledRole.id,
          code: disabledRole.code,
          name: disabledRole.name,
          status: 'DISABLED' as const,
          type: 'NORMAL' as const,
          assignable: false,
        },
      ],
    }
    vi.mocked(queryAdminRoles).mockResolvedValue({
      data: {
        items: [enabledRole, disabledRole],
        total: 2,
        page: 1,
        pageSize: 20,
      },
    })
    vi.mocked(getAdminUser).mockResolvedValue({ data: userWithDisabledRole })
    const vm = createUserManagementViewModel()

    await vm.openEdit(userWithDisabledRole)

    expect(vm.roleOptions.value).toContainEqual({
      title: 'disabled · 已停用角色（已停用）',
      value: disabledRole.id,
      props: { disabled: false, 'aria-disabled': undefined },
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

    vm.requestChangeEnabled(user)
    await vm.confirmPendingAction()
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
    vm.requestChangeEnabled(user)

    expect(setAdminUserEnabled).not.toHaveBeenCalled()
    expect(queryAdminUsers).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe('不能停用当前登录用户。')
    expect(vm.canChangeEnabled({ ...user, id: 'USER-2' })).toBe(true)
    expect(vm.canChangeEnabled({ ...user, status: 'DISABLED' })).toBe(false)
  })

  it('系统用户不提供编辑或启停操作，也不发起后端请求', async () => {
    const systemUser = {
      ...user,
      id: 'USER-SYSTEM',
      username: 'system',
      displayName: '系统用户',
      status: 'DISABLED' as const,
      system: true,
    }
    const vm = createUserManagementViewModel()

    expect(vm.isSystemUser(systemUser)).toBe(true)
    expect(vm.canEditUser(systemUser)).toBe(false)
    expect(vm.canChangeEnabled(systemUser)).toBe(false)
    expect(vm.canEditUser(user)).toBe(true)

    await vm.openEdit(systemUser)
    expect(getAdminUser).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe('系统用户由服务端维护，不能编辑。')

    vm.requestChangeEnabled(systemUser)
    expect(setAdminUserEnabled).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe('系统用户由服务端维护，不能修改状态。')
  })

  it('后端判定不可维护的用户只提供查看操作', () => {
    useSessionStore().permissions.push('/app/user/reset-password')
    const superiorUser = { ...user, id: 'USER-SUPERIOR', manageable: false }
    const vm = createUserManagementViewModel()

    expect(vm.canEditUser(superiorUser)).toBe(false)
    expect(vm.canViewUser(superiorUser)).toBe(true)
    expect(vm.canChangeEnabled(superiorUser)).toBe(false)
    expect(vm.canResetUserPassword(superiorUser)).toBe(false)
  })
})

describe('user management protected actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    const session = useSessionStore()
    session.permissions = [
      '/app/user/query',
      '/app/user/get',
      '/app/user/save',
      '/app/user/disable',
      '/app/role/query',
      '/app/user/reset-password',
    ]
    vi.mocked(queryAdminUsers).mockResolvedValue({
      data: { items: [user], total: 1, page: 1, pageSize: 20 },
    })
    vi.mocked(queryAdminRoles).mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    vi.mocked(resetAdminUserPassword).mockResolvedValue({
      data: { temporaryPassword: 'never-persisted' },
    })
  })

  it('重置密码操作包含列表刷新依赖的用户查询权限', () => {
    const session = useSessionStore()
    session.permissions = ['/app/user/reset-password']
    const vm = createUserManagementViewModel()

    expect(vm.canResetUserPassword(user)).toBe(false)
    vm.requestResetPassword(user)
    expect(vm.pendingAction.value).toBeNull()
    expect(resetAdminUserPassword).not.toHaveBeenCalled()
  })

  it('仅为启用的非本人普通用户提供一次性密码重置，并在刷新失败后保留结果', async () => {
    const vm = createUserManagementViewModel()
    expect(vm.canResetUserPassword(user)).toBe(true)
    expect(vm.canResetUserPassword({ ...user, status: 'DISABLED' })).toBe(false)
    const session = useSessionStore()
    session.user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    }
    expect(vm.canResetUserPassword(user)).toBe(false)

    session.user = null
    vm.requestResetPassword(user)
    const refresh = deferred<{
      data: {
        items: (typeof user)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    vi.mocked(queryAdminUsers).mockReturnValueOnce(refresh.promise)
    const reset = vm.confirmPendingAction()
    await Promise.resolve()
    expect(resetAdminUserPassword).toHaveBeenCalledWith({
      id: user.id,
      revision: user.revision,
    })
    expect(vm.temporaryPassword.value).toBe('never-persisted')
    refresh.reject(new Error('refresh failed'))
    await reset
    expect(vm.temporaryPassword.value).toBe('never-persisted')
    expect(vm.passwordSaved.value).toBe(false)
    await vm.closeResetResult()
    expect(vm.temporaryPassword.value).toBe('never-persisted')
    vm.passwordSaved.value = true
    await vm.closeResetResult()
    expect(vm.temporaryPassword.value).toBeNull()
  })

  it('页面离开同步清除临时密码，且挂起刷新不会将其写回', async () => {
    const vm = createUserManagementViewModel()
    const refresh = deferred<{
      data: {
        items: (typeof user)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    vi.mocked(queryAdminUsers).mockReturnValueOnce(refresh.promise)
    vm.requestResetPassword(user)

    const reset = vm.confirmPendingAction()
    await Promise.resolve()
    expect(vm.temporaryPassword.value).toBe('never-persisted')

    vm.dispose()
    expect(vm.temporaryPassword.value).toBeNull()
    expect(vm.passwordSaved.value).toBe(false)

    refresh.resolve({
      data: { items: [user], total: 1, page: 1, pageSize: 20 },
    })
    await reset
    expect(vm.temporaryPassword.value).toBeNull()
  })

  it('角色目录失败时保留重试入口并禁止创建保存', async () => {
    vi.mocked(queryAdminRoles).mockRejectedValueOnce(new Error('unavailable'))
    const vm = createUserManagementViewModel()
    await vm.openCreate()
    vm.form.username = 'new-user'
    vm.form.displayName = '新用户'
    vm.form.password = 'strong-password'
    vm.form.roleIds = ['role']
    expect(vm.roleErrorMessage.value).toContain('角色加载失败')
    expect(vm.canSubmit.value).toBe(false)
  })

  it('编辑依赖加载失败后可重试完整编辑上下文', async () => {
    vi.mocked(queryAdminRoles).mockRejectedValueOnce(new Error('unavailable'))
    const vm = createUserManagementViewModel()

    await vm.openEdit(user)
    expect(vm.roleErrorMessage.value).toContain('角色加载失败')
    expect(vm.editing.value).toBeNull()

    await vm.retryRoles()
    expect(vm.roleErrorMessage.value).toBeNull()
    expect(vm.editing.value).toEqual(user)
  })

  it('编辑详情失败时保持编辑模式并禁止退回创建提交', async () => {
    useSessionStore().permissions.push('/app/user/create')
    vi.mocked(queryAdminRoles).mockResolvedValueOnce({
      data: {
        items: [
          { ...roleListItem('ROLE-1', 'operator', '操作员'), assignable: true },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    vi.mocked(getAdminUser).mockRejectedValueOnce(new Error('unavailable'))
    const vm = createUserManagementViewModel()

    await vm.openEdit(user)
    vm.form.username = 'unexpected-create'
    vm.form.displayName = '不应创建'
    vm.form.password = 'Strong-password-1!'
    vm.form.roleIds = ['ROLE-1']

    expect(vm.editorMode.value).toBe('edit')
    expect(vm.editing.value).toBeNull()
    expect(vm.editorErrorMessage.value).toContain('用户详情加载失败')
    expect(vm.canSubmit.value).toBe(false)
    await vm.save()
    expect(createAdminUser).not.toHaveBeenCalled()
    expect(saveAdminUser).not.toHaveBeenCalled()
  })

  it('状态冲突刷新列表后仍保留重新决策提示', async () => {
    vi.mocked(setAdminUserEnabled).mockRejectedValueOnce(
      new ApiError('business', 'user revision conflict', {
        code: 3001,
        errorKey: 'user_changed',
      }),
    )
    const vm = createUserManagementViewModel()

    vm.requestChangeEnabled(user)
    await vm.confirmPendingAction()

    expect(queryAdminUsers).toHaveBeenCalledOnce()
    expect(vm.errorMessage.value).toBe('数据已更新，请根据最新状态重新操作。')
  })
})

it('脏编辑器通过统一关闭 seam 请求确认，确认后清除密码和表单', async () => {
  setActivePinia(createPinia())
  const session = useSessionStore()
  session.permissions = [
    '/app/user/query',
    '/app/user/create',
    '/app/role/query',
  ]
  vi.mocked(queryAdminRoles).mockResolvedValue({
    data: {
      items: [
        { ...roleListItem('ROLE-1', 'operator', '操作员'), assignable: true },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  })
  const vm = createUserManagementViewModel()
  await vm.openCreate()
  vm.form.username = 'pending-user'
  vm.form.password = 'Strong-password-1!'
  expect(vm.hasUnsavedChanges.value).toBe(true)
  vm.closeEditor()
  expect(vm.discardConfirmOpen.value).toBe(true)
  expect(vm.editorOpen.value).toBe(true)
  vm.confirmDiscard()
  expect(vm.editorOpen.value).toBe(false)
  expect(vm.form.password).toBe('')
})

it('本人含已停用角色时仍可仅保存显示名称且提交原角色集合', async () => {
  setActivePinia(createPinia())
  const session = useSessionStore()
  session.permissions = [
    '/app/user/query',
    '/app/user/get',
    '/app/user/save',
    '/app/role/query',
  ]
  session.user = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
  }
  const detail = {
    ...user,
    roles: [
      {
        id: 'ROLE-DISABLED',
        code: 'disabled',
        name: '已停用角色',
        status: 'DISABLED' as const,
        type: 'NORMAL' as const,
        assignable: false,
      },
    ],
  }
  vi.mocked(getAdminUser).mockResolvedValue({ data: detail })
  vi.mocked(queryAdminRoles).mockResolvedValue({
    data: {
      items: [
        {
          ...roleListItem('ROLE-DISABLED', 'disabled', '已停用角色'),
          status: 'DISABLED',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  })
  vi.mocked(saveAdminUser).mockResolvedValue({ data: detail })
  vi.spyOn(session, 'restore').mockResolvedValue(true)
  vi.mocked(queryAdminUsers).mockResolvedValue({
    data: { items: [user], total: 1, page: 1, pageSize: 20 },
  })
  const vm = createUserManagementViewModel()
  await vm.openEdit(user)
  expect(vm.rolesReadonly.value).toBe(true)
  vm.form.displayName = '更新后的本人名称'
  expect(vm.canSubmit.value).toBe(true)
  await vm.save()
  expect(saveAdminUser).toHaveBeenCalledWith({
    id: user.id,
    displayName: '更新后的本人名称',
    roleIds: ['ROLE-DISABLED'],
    revision: user.revision,
  })
})

it('用户角色候选只包含服务端可分配角色且保留既有不可分配关联', async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const session = useSessionStore()
  session.permissions = ['/app/user/get', '/app/user/save', '/app/role/query']
  const assignedSuperior = {
    id: 'ROLE-SUPERIOR',
    code: 'ROL-0099',
    name: '上级角色',
    status: 'ENABLED' as const,
    type: 'NORMAL' as const,
    assignable: false,
  }
  vi.mocked(getAdminUser).mockResolvedValue({
    data: {
      ...user,
      passwordChangedAt: '2026-08-05T00:00:00Z',
      manageable: true,
      roleAssignmentEditable: true,
      roles: [assignedSuperior],
    },
  })
  vi.mocked(queryAdminRoles).mockResolvedValue({
    data: {
      items: [
        {
          ...roleListItem('ROLE-ASSIGNABLE', 'ROL-0002', '可分配角色'),
          assignable: true,
        },
        {
          ...roleListItem('ROLE-SUPERIOR', 'ROL-0099', '上级角色'),
          assignable: false,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    },
  })
  const vm = createUserManagementViewModel()
  await vm.openEdit(user)

  expect(vm.roleOptions.value).toEqual([
    expect.objectContaining({ value: 'ROLE-ASSIGNABLE' }),
    expect.objectContaining({
      value: 'ROLE-SUPERIOR',
      props: expect.objectContaining({ disabled: false }),
    }),
  ])
})

it('后端判定上级用户不可维护时自动保持只读且不提交', async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const session = useSessionStore()
  session.permissions = ['/app/user/get', '/app/user/save', '/app/role/query']
  vi.mocked(getAdminUser).mockResolvedValue({
    data: {
      ...user,
      passwordChangedAt: '2026-08-05T00:00:00Z',
      manageable: false,
      roleAssignmentEditable: false,
      roles: [
        {
          id: 'ROLE-SUPERIOR',
          code: 'ROL-0099',
          name: '上级角色',
          status: 'ENABLED',
          type: 'NORMAL',
          assignable: false,
        },
      ],
    },
  })
  vi.mocked(queryAdminRoles).mockResolvedValue({
    data: { items: [], total: 0, page: 1, pageSize: 20 },
  })
  const vm = createUserManagementViewModel()
  await vm.openEdit(user)

  expect(vm.isDetail.value).toBe(true)
  expect(vm.rolesReadonly.value).toBe(true)
  await vm.save()
  expect(saveAdminUser).not.toHaveBeenCalled()
})

function roleListItem(id: string, code: string, name: string) {
  return {
    id,
    code,
    name,
    description: null,
    status: 'ENABLED' as const,
    type: 'NORMAL' as const,
    availableActions: ['VIEW'] as Array<'VIEW'>,
    assignable: false,
    createdAt: '2026-08-05T00:00:00Z',
    updatedAt: '2026-08-05T00:00:00Z',
    revision: 1,
  }
}
