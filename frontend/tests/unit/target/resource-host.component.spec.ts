import { flushPromises, mount } from '@vue/test-utils'
import { h, nextTick, onUnmounted, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userPage } from '@/target/definitions/user.ts'
import { rolePage } from '@/target/definitions/role.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { createResourceRegistry } from '@/target/navigation/registry.ts'

const harness = vi.hoisted(() => ({
  session: {
    generation: 1,
    allowed: true,
    hasResource: vi.fn(() => harness.session.allowed),
  },
}))

vi.mock('@/target/session/vm.ts', async () => {
  const { reactive } = await import('vue')
  harness.session = reactive(harness.session)
  return { useTargetSession: () => harness.session }
})

describe('business resource Host', () => {
  beforeEach(() => {
    harness.session.allowed = true
    harness.session.generation = 1
    harness.session.hasResource.mockClear()
  })

  it('shows an explicit identifier when an authorized resource is not registered', () => {
    const wrapper = mount(ResourceHost, {
      props: {
        domain: 'bob',
        entity: 'customer',
        registry: createResourceRegistry([]),
      },
      global: {
        stubs: {
          VContainer: { template: '<main><slot /></main>' },
          VCard: { template: '<section><slot /></section>' },
          VCardTitle: { template: '<h1><slot /></h1>' },
          VCardText: { template: '<div><slot /></div>' },
          VAlert: { template: '<div><slot /></div>' },
        },
      },
    })

    const unimplemented = wrapper.get('[data-testid="business-unimplemented"]')
    expect(unimplemented.text()).toContain('功能尚未实现')
    expect(unimplemented.text()).toContain('bob/customer')
  })

  it('destroys revoked instances and ignores their late async result after regrant', async () => {
    let created = 0
    const destroyed: number[] = []
    const completions: Array<(value: string) => void> = []
    const component = {
      setup() {
        const instance = ++created
        const value = ref(`waiting-${instance}`)
        const completion = new Promise<string>((resolve) =>
          completions.push(resolve),
        )
        void completion.then((next) => {
          value.value = next
        })
        onUnmounted(() => destroyed.push(instance))
        return () => h('div', { 'data-testid': 'registered' }, value.value)
      },
    }
    const wrapper = mount(ResourceHost, {
      props: {
        domain: 'app',
        entity: 'user',
        registry: createResourceRegistry([
          { domain: 'app', entity: 'user', definition: userPage },
        ]),
      },
      global: {
        stubs: {
          DirectPage: component,
          VEmptyState: {
            props: ['title'],
            template: '<div>{{ title }}</div>',
          },
        },
      },
    })
    expect(wrapper.get('[data-testid="registered"]').text()).toBe('waiting-1')

    harness.session.allowed = false
    await nextTick()
    expect(destroyed).toEqual([1])
    expect(wrapper.text()).toContain('无权访问')

    harness.session.generation += 1
    harness.session.allowed = true
    await nextTick()
    expect(wrapper.get('[data-testid="registered"]').text()).toBe('waiting-2')

    completions[0]?.('stale-result')
    await flushPromises()
    expect(wrapper.get('[data-testid="registered"]').text()).toBe('waiting-2')
    wrapper.unmount()
  })

  it('creates a fresh component instance when entering another resource', async () => {
    let created = 0
    const destroyed: number[] = []
    const component = {
      setup() {
        const instance = ++created
        onUnmounted(() => destroyed.push(instance))
        return () => h('div', { 'data-testid': 'registered' }, instance)
      },
    }
    const registry = createResourceRegistry([
      { domain: 'app', entity: 'user', definition: userPage },
      { domain: 'app', entity: 'role', definition: rolePage },
    ])
    const wrapper = mount(ResourceHost, {
      props: { domain: 'app', entity: 'user', registry },
      global: { stubs: { DirectPage: component } },
    })
    expect(wrapper.get('[data-testid="registered"]').text()).toBe('1')

    await wrapper.setProps({ entity: 'role' })

    expect(destroyed).toEqual([1])
    expect(wrapper.get('[data-testid="registered"]').text()).toBe('2')
    wrapper.unmount()
  })
})
