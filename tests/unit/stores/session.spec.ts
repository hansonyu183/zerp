import { describe, expect, it } from 'vitest'
import { normalizeMenus } from '@/stores/session'

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
