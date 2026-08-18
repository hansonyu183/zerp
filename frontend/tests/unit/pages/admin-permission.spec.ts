import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import Permission from '@/pages/app/permission/Permission.vue'
import permissionSource from '@/pages/app/permission/Permission.vue?raw'

vi.mock('@/pages/app/shared/api', () => ({
  queryAdminPermissions: vi.fn().mockResolvedValue({
    data: { items: [], total: 0, page: 1, pageSize: 20 },
  }),
  getAdminPermission: vi.fn(),
}))

describe('Permission management page', () => {
  it('隐藏后端不支持的关键词搜索控件', async () => {
    const wrapper = mount(Permission, {
      global: {
        plugins: [createPinia()],
        stubs: {
          BusinessObjectList: {
            name: 'BusinessObjectList',
            props: ['searchable'],
            template: '<section />',
          },
          AppSnackbar: true,
        },
      },
    })

    await flushPromises()
    expect(
      wrapper.findComponent({ name: 'BusinessObjectList' }).props('searchable'),
    ).toBe(false)
  })

  it('仅呈现权限目录的只读字段', async () => {
    const wrapper = mount(Permission, {
      global: {
        plugins: [createPinia()],
        stubs: {
          BusinessObjectList: {
            name: 'BusinessObjectList',
            props: ['columns'],
            template: '<section><slot /></section>',
          },
          AppSnackbar: true,
        },
      },
    })

    await flushPromises()
    const columns = wrapper
      .findComponent({ name: 'BusinessObjectList' })
      .props('columns') as Array<{ key: string }>

    expect(columns.map((column) => column.key)).toEqual([
      'path',
      'domain',
      'entity',
      'action',
      'status',
    ])
    expect(wrapper.text()).not.toContain('当前可授予')
    expect(permissionSource).toContain('title="领域"')
    expect(permissionSource).toContain('title="实体"')
    expect(permissionSource).toContain('title="动作"')
    expect(permissionSource).toContain('title="直接关联角色数"')
    expect(permissionSource).not.toContain('assignable')
  })
})
