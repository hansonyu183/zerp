import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import { expect, it, vi } from 'vitest'
import DynamicCols from '@/target/components/dynamic-fields/DynamicCols.vue'
vi.stubGlobal('visualViewport', {
  width: 1280,
  height: 800,
  offsetLeft: 0,
  offsetTop: 0,
  addEventListener() {},
  removeEventListener() {},
})
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
it('renders read-only report display rows without a synthetic business ID or action column', async () => {
  const wrapper = mount(DynamicCols, {
    props: {
      fields: [{ key: 'amount', type: 'text', caption: '金额', width: 240 }],
      items: [{ displayKey: '2:0', amount: '9007199254740993.001' }],
      identityKey: 'displayKey',
    },
    global: { plugins: [createVuetify()] },
  })
  await flushPromises()
  expect(wrapper.get('th').text()).toBe('金额')
  expect(wrapper.get('th').attributes('style')).toContain('240px')
  expect(wrapper.get('tbody').text()).toContain('9007199254740993.001')
  expect(wrapper.findAll('th')).toHaveLength(1)
  wrapper.unmount()
})

import NavigationMenu from '@/target/navigation/NavigationMenu.vue'
import ListPagination from '@/target/components/list-page/ListPagination.vue'
import {
  navigationIcon,
  presentNavigation,
} from '@/target/presentation/navigation-icons.ts'
import { collectNavigationResourceGroups } from '@/target/navigation/resources.ts'
import { createRouter, createMemoryHistory } from 'vue-router'
import RowActions from '@/target/components/dynamic-fields/RowActions.vue'

it('keeps unknown navigation text and routes while validating finite icon overrides', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:domain/:entity', component: { template: '<div />' } }],
  })
  await router.push('/aux/measurement-unit')
  const groups = presentNavigation(
    collectNavigationResourceGroups([
      '/aux/measurement-unit/query',
      '/rpt/rpt-000001/export',
      '/custom/future/query',
    ]),
  )
  const wrapper = mount(NavigationMenu, {
    props: { groups },
    global: { plugins: [router, createVuetify()] },
  })
  await flushPromises()
  expect(
    wrapper.get('a[href="/aux/measurement-unit"]').find('.mdi-ruler').exists(),
  ).toBe(true)
  expect(
    wrapper
      .get('a[href="/rpt/rpt-000001"]')
      .find('.mdi-chart-box-outline')
      .exists(),
  ).toBe(true)
  const unknown = wrapper.get('a[href="/custom/future"]')
  expect(unknown.text()).toContain('future')
  expect(unknown.find('.v-icon').exists()).toBe(false)
  await unknown.trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/custom/future')
  const custom = groups.find((group) => group.domain === 'custom')!
  custom.resources[0]!.icon = 'customer'
  await wrapper.setProps({ groups: [...groups] })
  expect(
    wrapper
      .get('a[href="/custom/future"]')
      .find('.mdi-account-group-outline')
      .exists(),
  ).toBe(true)
  expect(() => navigationIcon('mdi-anything')).toThrow('未登记')
  expect(() => navigationIcon('<svg>')).toThrow('未登记')
  wrapper.unmount()
})
it('uses finite action icons without changing action events or eligibility', async () => {
  const wrapper = mount(RowActions, {
    props: {
      actions: [
        { key: 'edit', caption: '编辑' },
        { key: 'disable', caption: '停用', disabled: true },
      ],
    },
    global: { plugins: [createVuetify()] },
  })
  expect(
    wrapper
      .get('[data-testid="row-action-edit"] .v-icon')
      .attributes('aria-hidden'),
  ).toBe('true')
  await wrapper.get('[data-testid="row-action-edit"]').trigger('click')
  expect(wrapper.emitted('action')).toEqual([['edit']])
  expect(
    wrapper.get('[data-testid="row-action-disable"]').attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper.get('[data-testid="row-action-edit"]').attributes('aria-label'),
  ).toBe('编辑')
  expect(wrapper.get('[data-testid="row-action-edit"]').text()).toBe('')
  wrapper.unmount()
})
it('paginates hasMore without inventing a total', async () => {
  const wrapper = mount(ListPagination, {
    props: { pagination: { mode: 'more', page: 2, hasMore: true } },
    global: { plugins: [createVuetify()] },
  })
  expect(wrapper.text()).not.toContain('共')
  const buttons = wrapper.findAll('button')
  await buttons[0]!.trigger('click')
  await buttons[1]!.trigger('click')
  expect(wrapper.emitted('page')).toEqual([[1], [3]])
  wrapper.unmount()
})

it('explains pagination icons on hover and keyboard focus while preserving paging', async () => {
  const wrapper = mount(ListPagination, {
    attachTo: document.body,
    props: { pagination: { mode: 'total', page: 2, pageSize: 20, total: 60 } },
    global: { plugins: [createVuetify()] },
  })
  try {
    await flushPromises()
    const previous = wrapper.get('.v-pagination__prev button')
    const next = wrapper.get('.v-pagination__next button')
    await previous.trigger('mouseenter')
    await vi.waitFor(() => {
      expect(
        document.querySelector('.v-tooltip.v-overlay--active')?.textContent,
      ).toBe('上一页')
    })
    await previous.trigger('mouseleave')
    ;(next.element as HTMLButtonElement).focus()
    await vi.waitFor(() => {
      expect(
        document.querySelector('.v-tooltip.v-overlay--active')?.textContent,
      ).toBe('下一页')
    })
    await next.trigger('blur')
    await previous.trigger('click')
    await next.trigger('click')
    expect(wrapper.emitted('page')).toEqual([[1], [3]])
    await wrapper.setProps({
      pagination: { mode: 'total', page: 1, pageSize: 20, total: 60 },
    })
    expect(previous.attributes('disabled')).toBeDefined()
    await wrapper.setProps({ disabled: true })
    expect(next.attributes('disabled')).toBeDefined()
  } finally {
    wrapper.unmount()
  }
})

it('keeps opposite approval intents distinct and emits the exact permitted action', async () => {
  const wrapper = mount(RowActions, {
    props: {
      actions: [
        { key: 'approve', caption: '批准' },
        { key: 'reject', caption: '驳回' },
        { key: 'unreject', caption: '恢复审核' },
        { key: 'unapprove', caption: '反批准', disabled: true },
      ],
    },
    global: { plugins: [createVuetify()] },
  })
  for (const [key, icon] of [
    ['approve', 'mdi-check-decagram-outline'],
    ['reject', 'mdi-close-circle-outline'],
    ['unreject', 'mdi-backup-restore'],
    ['unapprove', 'mdi-undo-variant'],
  ]) {
    expect(
      wrapper
        .get(`[data-testid="row-action-${key}"] .${icon}`)
        .attributes('aria-hidden'),
    ).toBe('true')
  }
  await wrapper.get('[data-testid="row-action-unreject"]').trigger('click')
  expect(wrapper.emitted('action')).toEqual([['unreject']])
  expect(
    wrapper.get('[data-testid="row-action-unapprove"]').attributes('disabled'),
  ).toBeDefined()
  wrapper.unmount()
})
