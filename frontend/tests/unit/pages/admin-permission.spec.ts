import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import Permission from '@/pages/admin/permission/Permission.vue'

vi.mock('@/pages/admin/shared/api', () => ({
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
})
