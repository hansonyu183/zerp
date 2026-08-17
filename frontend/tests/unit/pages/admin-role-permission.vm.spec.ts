import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAdminPermission,
  queryAdminPermissions,
} from '@/pages/admin/shared/api'
import { createPermissionManagementViewModel } from '@/pages/admin/permission/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/pages/admin/shared/api', () => ({
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
  assignable: true,
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

describe('permission management view model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    const session = useSessionStore()
    session.permissions = ['/app/permission/query', '/app/permission/get']
    vi.mocked(queryAdminPermissions).mockResolvedValue({
      data: { items: [permission], total: 1, page: 1, pageSize: 20 },
    })
    vi.mocked(getAdminPermission).mockResolvedValue({ data: permission })
  })

  it('权限目录只支持筛选和详情读取', async () => {
    const vm = createPermissionManagementViewModel()
    vm.status.value = 'ENABLED'
    await vm.query()
    await vm.openDetail(permission)

    expect(queryAdminPermissions).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      filters: { status: 'ENABLED' },
      sort: [{ field: 'path', order: 'asc' }],
    })
    expect(getAdminPermission).toHaveBeenCalledWith('PERMISSION-1')
    expect(vm.detail.value).toEqual(permission)
  })

  it('忽略乱序的旧权限详情响应', async () => {
    const first = deferred<{ data: typeof permission }>()
    const second = deferred<{ data: typeof permission }>()
    const otherPermission = {
      ...permission,
      id: 'PERMISSION-2',
      path: '/app/role/get',
      entity: 'role',
      description: '查看角色',
      revision: 2,
    }
    vi.mocked(getAdminPermission)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const vm = createPermissionManagementViewModel()

    const firstLoad = vm.openDetail(permission)
    const secondLoad = vm.openDetail(otherPermission)
    second.resolve({ data: otherPermission })
    await secondLoad
    first.resolve({ data: permission })
    await firstLoad

    expect(vm.detail.value).toEqual(otherPermission)
    expect(vm.loading.value).toBe(false)
  })

  it('忽略乱序的旧权限查询错误', async () => {
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

    vm.status.value = 'ENABLED'
    const olderQuery = vm.query()
    vm.status.value = 'DISABLED'
    const newerQuery = vm.query()
    second.resolve({
      data: {
        items: [{ ...permission, id: 'PERMISSION-NEW' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await newerQuery
    first.reject(new Error('旧查询失败'))
    await olderQuery

    expect(vm.rows.value).toEqual([{ ...permission, id: 'PERMISSION-NEW' }])
    expect(vm.errorMessage.value).toBeNull()
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
