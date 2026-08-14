import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

function menuResponse(
  routes: Array<{
    id: string
    group?: string
    routeKey: string
    routePath: string
    title: string
  }> = [],
) {
  const groupIDs = [...new Set(routes.map((route) => route.group ?? 'group-1'))]
  const items = [
    ...groupIDs.map((id, index) => ({
      id,
      parentId: null,
      type: 'GROUP',
      level: 1,
      order: (index + 1) * 10,
      displayName: id === 'wfl-group' ? '业务流程' : '业务对象',
      icon: null,
      enabled: true,
      routeKey: null,
      routePath: null,
      permissionCode: null,
    })),
    ...routes.map((route, index) => ({
      id: route.id,
      parentId: route.group ?? 'group-1',
      type: 'ROUTE',
      level: 2,
      order: (index + 1) * 10,
      displayName: route.title,
      icon: null,
      enabled: true,
      routeKey: route.routeKey,
      routePath: route.routePath,
      permissionCode: `/${route.routeKey}/query`,
    })),
  ]
  const tree = { revision: 1, items }
  return {
    data: {
      mode: 'DEFAULT',
      modeRevision: 1,
      catalogRevision: 'catalog-revision',
      defaultMenu: tree,
      businessTemplate: tree,
      navigation: tree,
      availableRoutes: [],
    },
  }
}

describe('useSessionStore permissions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('恢复权限并根据本地注册表生成 Home 菜单', async () => {
    mockedApiClient.post
      .mockResolvedValueOnce({
        data: {
          user: { id: '1', username: 'admin', displayName: '管理员' },
          csrfToken: 'csrf-1',
          permissions: [
            '/app/user/signout',
            '/bob/customer/query',
            '/bob/customer/create',
            '/bob/customer/query',
            'bob/customer/update',
          ],
        },
      })
      .mockResolvedValueOnce(
        menuResponse([
          {
            id: 'customer',
            routeKey: 'bob/customer',
            routePath: '/bob/customer',
            title: '客户',
          },
        ]),
      )
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(true)

    expect(session.permissions).toEqual([
      '/app/user/signout',
      '/bob/customer/query',
      '/bob/customer/create',
    ])
    expect(session.menus).toHaveLength(1)
    expect(session.menus[0]?.domain).toBe('group-1')
    expect(session.menus[0]?.children[0]).toMatchObject({
      entity: 'customer',
      actions: ['query', 'create'],
    })
    expect(session.can('/bob/customer/create')).toBe(true)
    expect(session.can('/bob/customer/update')).toBe(false)
    expect(mockedApiClient.setCsrfToken).toHaveBeenLastCalledWith('csrf-1')
  })

  it('不兼容旧 menus 字段且缺少 permissions 时生成空菜单', async () => {
    mockedApiClient.post
      .mockResolvedValueOnce({
        data: {
          user: { id: '1', username: 'admin', displayName: '管理员' },
          csrfToken: 'csrf-1',
          menus: [
            {
              domain: 'bob',
              title: '基础业务对象',
              children: [
                { entity: 'customer', title: '客户', actions: ['query'] },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce(menuResponse())
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(true)
    expect(session.permissions).toEqual([])
    expect(session.menus).toEqual([])
  })

  it('服务端导航只控制菜单显示，授权页面路由仍由权限生成', () => {
    const session = useSessionStore()
    session.permissions = ['/bob/customer/query']
    session.applyMenuData(menuResponse().data)

    expect(session.menus).toEqual([])
    expect(session.routeMenus).toMatchObject([
      {
        domain: 'bob',
        children: [{ entity: 'customer', actions: ['query'] }],
      },
    ])
  })

  it('只用一次 session 返回的 API 权限生成动态流程菜单', async () => {
    mockedApiClient.post
      .mockResolvedValueOnce({
        data: {
          user: { id: '1', username: 'admin', displayName: '管理员' },
          csrfToken: 'csrf-1',
          permissions: [
            '/wfl/process-instance/query',
            '/wfl/sales-fulfillment/query',
            '/wfl/sales-fulfillment/get',
            '/wfl/purchase-fulfillment/get',
          ],
        },
      })
      .mockResolvedValueOnce(
        menuResponse([
          {
            id: 'process-instance',
            group: 'wfl-group',
            routeKey: 'wfl/process-instance',
            routePath: '/wfl/process-instance',
            title: '流程实例',
          },
          {
            id: 'sales-fulfillment',
            group: 'wfl-group',
            routeKey: 'wfl/sales-fulfillment',
            routePath: '/wfl/sales-fulfillment',
            title: '销售履约',
          },
        ]),
      )
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(true)

    expect(session.menus).toMatchObject([
      {
        domain: 'wfl-group',
        children: [
          {
            entity: 'process-instance',
            title: '流程实例',
            actions: ['query'],
          },
          {
            entity: 'sales-fulfillment',
            title: '销售履约',
            actions: ['query', 'get'],
          },
        ],
      },
    ])
    expect(mockedApiClient.post).toHaveBeenCalledTimes(2)
    expect(mockedApiClient.post).toHaveBeenCalledWith('app/user/session', {})
    expect(mockedApiClient.post).toHaveBeenCalledWith('app/menu/get', {})
  })

  it('支持强制恢复会话以处理 BFCache 恢复', async () => {
    mockedApiClient.post.mockImplementation(async (path) =>
      path === 'app/menu/get'
        ? menuResponse()
        : {
            data: {
              user: { id: '1', username: 'admin', displayName: '管理员' },
              csrfToken: 'csrf-1',
              permissions: [],
            },
          },
    )
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(true)
    await expect(session.restore()).resolves.toBe(true)
    await expect(session.restore({ force: true })).resolves.toBe(true)

    expect(mockedApiClient.post).toHaveBeenCalledTimes(4)
  })

  it('退出时清空用户、权限、菜单和 CSRF', async () => {
    mockedApiClient.post
      .mockResolvedValueOnce({
        data: {
          user: { id: '1', username: 'admin', displayName: '管理员' },
          csrfToken: 'csrf-1',
          permissions: ['/bob/customer/query'],
        },
      })
      .mockResolvedValueOnce(
        menuResponse([
          {
            id: 'customer',
            routeKey: 'bob/customer',
            routePath: '/bob/customer',
            title: '客户',
          },
        ]),
      )
      .mockResolvedValueOnce({ data: null })
    const session = useSessionStore()

    await session.restore()
    await session.signOut()

    expect(session.user).toBeNull()
    expect(session.permissions).toEqual([])
    expect(session.menus).toEqual([])
    expect(session.can('/bob/customer/query')).toBe(false)
    expect(mockedApiClient.setCsrfToken).toHaveBeenLastCalledWith(null)
  })
})

describe('useSessionStore.restore errors', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it.each([1001, '1001'])(
    '将未登录业务码 %p 视为正常状态且不展示错误',
    async (code) => {
      vi.spyOn(apiClient, 'post').mockRejectedValue(
        new ApiError('business', 'session expired', {
          code,
          requestId: 'req-session',
        }),
      )
      const session = useSessionStore()

      await expect(session.restore()).resolves.toBe(false)

      expect(session.initialized).toBe(true)
      expect(session.authenticated).toBe(false)
      expect(session.errorMessage).toBeNull()
    },
  )

  it('保留真实网络错误供登录页展示', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError('network', '无法连接真实后端 API。'),
    )
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(false)

    expect(session.initialized).toBe(true)
    expect(session.authenticated).toBe(false)
    expect(session.errorMessage).toBe('网络连接失败，请检查网络后重试。')
  })

  it('菜单加载失败时保留已恢复的认证会话和权限', async () => {
    mockedApiClient.post
      .mockResolvedValueOnce({
        data: {
          user: { id: '1', username: 'admin', displayName: '管理员' },
          csrfToken: 'csrf-1',
          permissions: ['/bob/customer/query'],
        },
      })
      .mockRejectedValueOnce(new ApiError('network', 'menu unavailable'))
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(true)

    expect(session.authenticated).toBe(true)
    expect(session.user?.username).toBe('admin')
    expect(session.permissions).toEqual(['/bob/customer/query'])
    expect(session.can('/bob/customer/query')).toBe(true)
    expect(session.errorMessage).toBeNull()
    expect(session.menuErrorMessage).toBe(
      '菜单加载失败：网络连接失败，请检查网络后重试。',
    )
    expect(mockedApiClient.setCsrfToken).toHaveBeenLastCalledWith('csrf-1')

    mockedApiClient.post.mockResolvedValueOnce(menuResponse())
    await expect(session.retryMenu()).resolves.toBeUndefined()
    expect(session.errorMessage).toBeNull()
    expect(session.menuErrorMessage).toBeNull()
  })

  it.each(['restore', 'signIn'] as const)(
    '%s 成功后菜单返回未认证时清空会话',
    async (action) => {
      mockedApiClient.post
        .mockResolvedValueOnce({
          data: {
            user: { id: '1', username: 'admin', displayName: '管理员' },
            csrfToken: 'csrf-1',
            permissions: ['/bob/customer/query'],
          },
        })
        .mockRejectedValueOnce(
          new ApiError('business', '登录状态已失效', { code: 1001 }),
        )
      const session = useSessionStore()

      if (action === 'restore') {
        await expect(session.restore()).resolves.toBe(false)
        expect(session.errorMessage).toBeNull()
      } else {
        await expect(
          session.signIn({ username: 'admin', password: 'correct' }),
        ).rejects.toThrow('登录状态已失效')
      }

      expect(session.authenticated).toBe(false)
      expect(session.permissions).toEqual([])
      expect(session.csrfToken).toBeNull()
      expect(session.menus).toEqual([])
      expect(mockedApiClient.setCsrfToken).toHaveBeenLastCalledWith(null)
    },
  )

  it('登录密码错误时显示后端返回的剩余重试次数', async () => {
    mockedApiClient.post.mockRejectedValue(
      new ApiError('business', '密码错误，剩余重试次数 4。', {
        code: 1001,
      }),
    )
    const session = useSessionStore()

    await expect(
      session.signIn({ username: 'preview-admin', password: 'wrong' }),
    ).rejects.toThrow('密码错误，剩余重试次数 4。')

    expect(session.errorMessage).toBe('密码错误，剩余重试次数 4。')
    expect(session.user).toBeNull()
  })

  it('登录成功但菜单加载失败时不撤销认证结果', async () => {
    mockedApiClient.post
      .mockResolvedValueOnce({
        data: {
          user: { id: '1', username: 'admin', displayName: '管理员' },
          csrfToken: 'csrf-1',
          permissions: ['/bob/customer/query'],
        },
      })
      .mockRejectedValueOnce(new ApiError('network', 'menu unavailable'))
    const session = useSessionStore()

    await expect(
      session.signIn({ username: 'admin', password: 'correct' }),
    ).resolves.toBeUndefined()

    expect(session.authenticated).toBe(true)
    expect(session.permissions).toEqual(['/bob/customer/query'])
    expect(session.errorMessage).toBeNull()
    expect(session.menuErrorMessage).toBe(
      '菜单加载失败：网络连接失败，请检查网络后重试。',
    )
  })

  it('重试菜单返回未认证时清空会话并向调用者报告失效', async () => {
    mockedApiClient.post
      .mockResolvedValueOnce({
        data: {
          user: { id: '1', username: 'admin', displayName: '管理员' },
          csrfToken: 'csrf-1',
          permissions: ['/bob/customer/query'],
        },
      })
      .mockRejectedValueOnce(new ApiError('network', 'menu unavailable'))
    const session = useSessionStore()
    await expect(session.restore()).resolves.toBe(true)

    mockedApiClient.post.mockRejectedValueOnce(
      new ApiError('business', '登录状态已失效', { code: 1001 }),
    )

    await expect(session.retryMenu()).rejects.toThrow('登录状态已失效')
    expect(session.authenticated).toBe(false)
    expect(session.permissions).toEqual([])
    expect(session.csrfToken).toBeNull()
    expect(session.menuErrorMessage).toBeNull()
    expect(mockedApiClient.setCsrfToken).toHaveBeenLastCalledWith(null)
  })
})

describe('useSessionStore account actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('使用空对象读取当前资料', async () => {
    mockedApiClient.post.mockResolvedValue({
      data: {
        id: '1',
        username: 'admin',
        displayName: '管理员',
        avatarUrl: 'https://example.com/avatar.png',
      },
    })
    const session = useSessionStore()

    await expect(session.getProfile()).resolves.toMatchObject({
      displayName: '管理员',
      avatarUrl: 'https://example.com/avatar.png',
    })
    expect(mockedApiClient.post).toHaveBeenCalledWith('app/user/profile', {})
  })

  it('保存名称和头像且不提交 revision', async () => {
    mockedApiClient.post.mockResolvedValue({
      data: {
        id: '1',
        username: 'admin',
        displayName: '新名称',
        avatarUrl: null,
        revision: 4,
      },
    })
    const session = useSessionStore()

    await session.updateProfile({
      displayName: '新名称',
      avatarUrl: null,
    })

    expect(mockedApiClient.post).toHaveBeenCalledWith('app/user/profile', {
      displayName: '新名称',
      avatarUrl: null,
    })
    expect(session.user).toEqual({
      id: '1',
      username: 'admin',
      displayName: '新名称',
      avatarUrl: null,
    })
  })

  it('改密成功后清理会话并使用正确路径', async () => {
    mockedApiClient.post.mockResolvedValue({ data: null })
    const session = useSessionStore()
    session.user = {
      id: '1',
      username: 'admin',
      displayName: '管理员',
    }
    session.permissions = ['/bob/customer/query']
    session.csrfToken = 'csrf-1'

    await session.changePassword({
      currentPassword: 'Current-password-1!',
      newPassword: 'New-password-2!',
    })

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      'app/user/change-password',
      {
        currentPassword: 'Current-password-1!',
        newPassword: 'New-password-2!',
      },
    )
    expect(session.user).toBeNull()
    expect(session.permissions).toEqual([])
    expect(session.csrfToken).toBeNull()
    expect(mockedApiClient.setCsrfToken).toHaveBeenLastCalledWith(null)
  })

  it('资料保存失败时保留当前资料且不提交 revision', async () => {
    mockedApiClient.post.mockRejectedValue(
      new ApiError('business', '资料保存失败。'),
    )
    const session = useSessionStore()
    session.user = {
      id: '1',
      username: 'admin',
      displayName: '原名称',
      avatarUrl: null,
    }

    await expect(
      session.updateProfile({
        displayName: '新名称',
        avatarUrl: 'https://example.com/avatar.png',
      }),
    ).rejects.toThrow('资料保存失败。')

    expect(session.user?.displayName).toBe('原名称')
    expect(session.errorMessage).toBe('资料保存失败。')
    expect(mockedApiClient.post).toHaveBeenCalledWith('app/user/profile', {
      displayName: '新名称',
      avatarUrl: 'https://example.com/avatar.png',
    })
  })

  it('改密失败时保留当前会话并暴露错误', async () => {
    mockedApiClient.post.mockRejectedValue(
      new ApiError('business', '当前密码错误。'),
    )
    const session = useSessionStore()
    session.user = {
      id: '1',
      username: 'admin',
      displayName: '管理员',
    }

    await expect(
      session.changePassword({
        currentPassword: 'wrong',
        newPassword: 'New-password-2!',
      }),
    ).rejects.toThrow('当前密码错误。')

    expect(session.user?.username).toBe('admin')
    expect(session.errorMessage).toBe('当前密码错误。')
  })
})
