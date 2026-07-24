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

describe('useSessionStore permissions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('恢复权限并根据本地注册表生成 Home 菜单', async () => {
    mockedApiClient.post.mockResolvedValue({
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
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(true)

    expect(session.permissions).toEqual([
      '/app/user/signout',
      '/bob/customer/query',
      '/bob/customer/create',
    ])
    expect(session.menus).toHaveLength(1)
    expect(session.menus[0]?.domain).toBe('bob')
    expect(session.menus[0]?.children[0]).toMatchObject({
      entity: 'customer',
      actions: ['query', 'create'],
    })
    expect(session.can('/bob/customer/create')).toBe(true)
    expect(session.can('/bob/customer/update')).toBe(false)
    expect(mockedApiClient.setCsrfToken).toHaveBeenLastCalledWith('csrf-1')
  })

  it('不兼容旧 menus 字段且缺少 permissions 时生成空菜单', async () => {
    mockedApiClient.post.mockResolvedValue({
      data: {
        user: { id: '1', username: 'admin', displayName: '管理员' },
        csrfToken: 'csrf-1',
        menus: [
          {
            domain: 'bob',
            title: '基础业务对象',
            children: [{ entity: 'customer', title: '客户', actions: ['query'] }],
          },
        ],
      },
    })
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(true)
    expect(session.permissions).toEqual([])
    expect(session.menus).toEqual([])
  })

  it('支持强制恢复会话以处理 BFCache 恢复', async () => {
    mockedApiClient.post.mockResolvedValue({
      data: {
        user: { id: '1', username: 'admin', displayName: '管理员' },
        csrfToken: 'csrf-1',
        permissions: [],
      },
    })
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(true)
    await expect(session.restore()).resolves.toBe(true)
    await expect(session.restore({ force: true })).resolves.toBe(true)

    expect(mockedApiClient.post).toHaveBeenCalledTimes(2)
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
    expect(session.errorMessage).toBe('无法连接真实后端 API。')
  })
})
