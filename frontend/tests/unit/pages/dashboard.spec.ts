import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Dashboard from '@/pages/home/dashboard/Dashboard.vue'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/home/dashboard', component: Dashboard },
      { path: '/bob/customer', component: { template: '<div />' } },
    ],
  })
}

describe('Dashboard quick starts', () => {
  it('仅允许已注册业务页快捷入口导航', async () => {
    setActivePinia(createPinia())
    const router = createTestRouter()
    await router.push('/home/dashboard')

    const wrapper = mount(Dashboard, {
      global: {
        plugins: [router],
        stubs: {
          VAvatar: { template: '<div><slot /></div>' },
          VAlert: { template: '<div><slot /></div>' },
          VBtn: {
            props: ['disabled'],
            emits: ['click'],
            template: '<button :disabled="disabled" @click="$emit(`click`)"><slot /></button>',
          },
          VCard: { template: '<section><slot /></section>' },
          VCol: { template: '<div><slot /></div>' },
          VContainer: { template: '<main><slot /></main>' },
          VIcon: { template: '<span />' },
          VRow: { template: '<div><slot /></div>' },
          VSheet: { template: '<section><slot /></section>' },
        },
      },
    })

    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual([
      '查看模块',
      '暂未开放',
      '暂未开放',
    ])
    expect(buttons[0].attributes('disabled')).toBeUndefined()
    expect(buttons[1].attributes('disabled')).toBeDefined()
    expect(buttons[2].attributes('disabled')).toBeDefined()

    await buttons[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/bob/customer')
  })
})
