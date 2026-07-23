import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import { normalizeMenus, useSessionStore } from '@/stores/session'

describe('normalizeMenus', () => {
  it.each([undefined, null, {}, 'menus'])('将非数组菜单 %p 归一化为空数组', (menus) => {
    expect(normalizeMenus(menus)).toEqual([])
  })

  it('保留有效菜单并清理无效字段', () => {
    expect(normalizeMenus([
      {
        domain: 'app',
        title: '系统能力',
        children: [
          {
            entity: 'user',
            title: '用户',
            actions: ['query'],
          },
        ],
      },
      {
        domain: 'bob',
        title: '基础资料',
        children: [
          {
            entity: 'customer',
            title: '客户',
            actions: ['query', 42, 'create'],
          },
          null,
        ],
      },
      { domain: 'invalid-without-title', children: [] },
    ])).toEqual([
      {
        domain: 'bob',
        title: '基础资料',
        children: [
          {
            entity: 'customer',
            title: '客户',
            actions: ['query', 'create'],
          },
        ],
      },
    ])
  })

  it('不将 app 领域 API 放入 Home 动态菜单', () => {
    expect(normalizeMenus([
      {
        domain: 'app',
        title: '应用访问与权限',
        children: [
          {
            entity: 'role',
            title: '角色',
            actions: ['query', 'update'],
          },
        ],
      },
    ])).toEqual([])
  })
})

describe('useSessionStore.restore', () => {
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

  it('继续恢复有效会话', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          username: 'owner',
          displayName: 'Owner',
        },
        csrfToken: 'csrf-session',
        menus: [],
      },
      requestId: 'req-session',
    })
    const session = useSessionStore()

    await expect(session.restore()).resolves.toBe(true)

    expect(session.initialized).toBe(true)
    expect(session.authenticated).toBe(true)
    expect(session.user?.id).toBe('user-1')
    expect(session.errorMessage).toBeNull()
  })
})
