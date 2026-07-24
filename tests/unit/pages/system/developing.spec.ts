import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import Developing from '@/pages/system/developing/Developing.vue'

describe('Developing page', () => {
  it('在内容区域显示开发中提示和当前业务标识', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/bob/supplier',
          component: Developing,
        },
      ],
    })
    await router.push('/bob/supplier')
    await router.isReady()

    const wrapper = mount(Developing, {
      global: {
        plugins: [router],
        stubs: {
          VContainer: {
            template: '<main><slot /></main>',
          },
          VIcon: true,
        },
      },
    })

    expect(wrapper.text()).toContain('开发中...')
    expect(wrapper.text()).toContain('bob / supplier')
  })
})
