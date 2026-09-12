import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import ReferencePicker from '@/target/components/dynamic-fields/ReferencePicker.vue'
import { useTargetSession } from '@/target/session/vm.ts'
const api = vi.hoisted(() => ({ roles: vi.fn(), permissions: vi.fn() }))
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetRoleOptions: api.roles,
  queryTargetPermissionOptions: api.permissions,
}))
const input = defineComponent({
  props: ['field', 'modelValue', 'disabled'],
  emits: ['search', 'update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('div', [
        h('input', {
          'aria-label': '搜索',
          onInput: (event: Event) =>
            emit('search', (event.target as HTMLInputElement).value),
        }),
        ...props.field.options.map(
          (item: { value: string; caption: string; disabled: boolean }) =>
            h(
              'button',
              {
                'data-option': item.value,
                disabled: props.disabled || item.disabled,
                onClick: () => emit('update:modelValue', [item.value]),
              },
              item.caption,
            ),
        ),
        h(
          'button',
          { 'data-clear': true, onClick: () => emit('update:modelValue', []) },
          '清空',
        ),
        h('span', { 'data-selected': true }, JSON.stringify(props.modelValue)),
      ])
  },
})
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  const s = useTargetSession()
  s.csrfToken = 'csrf'
  api.roles.mockReset()
  api.permissions.mockReset()
})
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
})
const role = (id: string) => ({
  id,
  code: id,
  name: `角色${id}`,
  type: 'NORMAL' as const,
  enabled: true,
  assignable: true,
})
function picker() {
  const w = mount(ReferencePicker, {
    props: {
      source: 'roles',
      caption: '角色',
      modelValue: ['old'],
      existing: [{ id: 'old', name: '历史角色' }],
      multiple: true,
      disabled: false,
    },
    global: {
      stubs: {
        FieldInput: input,
        VBtn: { template: '<button><slot /></button>' },
        VAlert: { template: '<div><slot /></div>' },
      },
    },
  })
  wrappers.push(w)
  return w
}
it('无管理权限仍远程分页，后续页可选且历史选择不丢失', async () => {
  api.roles.mockImplementation(({ page }: { page: string }) =>
    Promise.resolve({
      items: [role(page === '1' ? 'one' : 'later')],
      total: 205,
      page: Number(page),
      pageSize: 20,
    }),
  )
  const w = picker()
  await flushPromises()
  expect(api.roles).toHaveBeenCalledTimes(1)
  expect(w.text()).toContain('历史角色')
  await w
    .findAll('button')
    .find((b) => b.text() === '下一页')!
    .trigger('click')
  await flushPromises()
  expect(api.roles).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: '2' }),
  )
  expect(w.text()).toContain('角色later')
  expect(w.get('[data-selected]').text()).toBe('["old"]')
})
it('加载失败显示中文反馈并可重试', async () => {
  api.roles.mockRejectedValueOnce(new Error('读取失败'))
  const w = picker()
  await flushPromises()
  expect(w.text()).toContain('候选加载失败，请重试。')
  api.roles.mockResolvedValue({
    items: [role('ok')],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  await w
    .findAll('button')
    .find((b) => b.text() === '重试')!
    .trigger('click')
  await flushPromises()
  expect(w.text()).toContain('角色ok')
})
function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const pageOf = (id: string) => ({
  items: [role(id)],
  total: 1,
  page: 1,
  pageSize: 20,
})
it('快速搜索忽略迟到结果，翻页后的选择和清空通过正式事件提交', async () => {
  vi.useFakeTimers()
  const slow = pending<ReturnType<typeof pageOf>>()
  api.roles
    .mockResolvedValueOnce(pageOf('initial'))
    .mockReturnValueOnce(slow.promise)
    .mockResolvedValueOnce(pageOf('new'))
  const w = picker()
  await flushPromises()
  await w.get('input').setValue('slow')
  await vi.advanceTimersByTimeAsync(250)
  await w.get('input').setValue('new')
  await vi.advanceTimersByTimeAsync(250)
  await flushPromises()
  expect(w.text()).toContain('角色new')
  slow.resolve(pageOf('slow'))
  await flushPromises()
  expect(w.text()).not.toContain('角色slow')
  expect(w.text()).toContain('历史角色')
  await w.get('[data-option="new"]').trigger('click')
  expect(w.emitted('update:modelValue')?.at(-1)).toEqual([['new']])
  await w.setProps({ modelValue: ['new'] })
  await w.get('[data-clear]').trigger('click')
  expect(w.emitted('update:modelValue')?.at(-1)).toEqual([[]])
})
it('切源、账号变化和销毁均阻止迟到候选回写', async () => {
  const slow = pending<ReturnType<typeof pageOf>>()
  api.roles.mockReturnValueOnce(slow.promise)
  api.permissions.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  const w = picker()
  await w.setProps({ source: 'permissions', modelValue: [], existing: [] })
  await flushPromises()
  slow.resolve(pageOf('old-source'))
  await flushPromises()
  expect(w.text()).not.toContain('old-source')
  const next = pending<ReturnType<typeof pageOf>>()
  api.roles.mockReturnValueOnce(next.promise)
  await w.setProps({ source: 'roles' })
  useTargetSession().generation += 1
  await flushPromises()
  next.resolve(pageOf('old-account'))
  await flushPromises()
  expect(w.text()).not.toContain('old-account')
  const last = pending<ReturnType<typeof pageOf>>()
  api.roles.mockReturnValueOnce(last.promise)
  const removed = picker()
  removed.unmount()
  const events = removed.emitted('resolved')?.length ?? 0
  last.resolve(pageOf('unmounted'))
  await flushPromises()
  expect(removed.emitted('resolved')?.length ?? 0).toBe(events)
})
it('超过一页的已选身份全部回显，历史项不会作为新候选重新加入', async () => {
  const ids = Array.from({ length: 25 }, (_, index) => `history-${index}`)
  api.roles.mockImplementation(({ ids: selectedIds }: { ids?: string[] }) =>
    Promise.resolve({
      items: selectedIds?.map((id) => ({ ...role(id), enabled: false })) ?? [],
      total: selectedIds?.length ?? 0,
      page: 1,
      pageSize: 20,
    }),
  )
  const w = picker()
  await w.setProps({ modelValue: ids, existing: [] })
  await flushPromises()
  expect(w.text()).toContain('角色history-24')
  expect(
    api.roles.mock.calls
      .filter(([query]) => query.ids)
      .every(([query]) => query.ids.length <= 20),
  ).toBe(true)
  await w.setProps({ modelValue: [] })
  await flushPromises()
  expect(w.find('[data-option="history-24"]').exists()).toBe(false)
})
