import { describe, expect, it, vi } from 'vitest'

import {
  ListActionRefreshRequiredError,
  ListActionUnresolvedError,
  useListPageViewModel,
  type EnabledListItem,
} from '@/target/components/list-page/vm.ts'

type Item = EnabledListItem & { revision: string }
type Filters = {
  keyword: string
  enabled: boolean
  businessDate: { from: string; to: string }
}

const item = (id: string, name = id): Item => ({
  id,
  code: id,
  py: id,
  name,
  enabled: true,
  revision: '1',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('public ListPage view-model seam', () => {
  it('queries once on entry only when search is authorized and submits input explicitly', async () => {
    const onSearch = vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    const searchable = useListPageViewModel<Item>({ onSearch })

    searchable.filterInput.value.keyword = ' 未提交 '
    await searchable.initialize()
    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenLastCalledWith({
      keyword: '',
      page: 1,
      pageSize: 20,
    })

    await searchable.submitSearch()
    expect(onSearch).toHaveBeenLastCalledWith({
      keyword: '未提交',
      page: 1,
      pageSize: 20,
    })
    expect(searchable.appliedQuery.value).toEqual({
      keyword: '未提交',
      page: 1,
    })

    const createOnly = useListPageViewModel<Item>({
      onCreate: vi.fn().mockResolvedValue(undefined),
    })
    await createOnly.initialize()
    expect(createOnly.loading.value).toBe(false)
  })

  it('keeps the newest query when controlled responses complete out of order', async () => {
    const first = deferred<{
      items: Item[]
      total: number
      page: number
      pageSize: number
    }>()
    const second = deferred<{
      items: Item[]
      total: number
      page: number
      pageSize: number
    }>()
    const onSearch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const vm = useListPageViewModel<Item>({ onSearch })

    const oldRequest = vm.initialize()
    vm.filterInput.value.keyword = 'new'
    const newRequest = vm.submitSearch()
    second.resolve({
      items: [item('new')],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    await newRequest
    first.resolve({
      items: [item('old')],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    await oldRequest

    expect(vm.items.value.map(({ id }) => id)).toEqual(['new'])
    expect(vm.appliedQuery.value.keyword).toBe('new')
  })

  it('uses a deep-copied submitted filter snapshot for paging and exactly one post-change refresh', async () => {
    const onSearch = vi.fn().mockResolvedValue({
      items: [item('u1')],
      total: 21,
      page: 1,
      pageSize: 20,
    })
    const onEdit = vi.fn().mockResolvedValue('changed' as const)
    const vm = useListPageViewModel<Item, Filters>(
      { onSearch, onEdit },
      {
        initialFilters: () => ({
          keyword: '',
          enabled: true,
          businessDate: { from: '2026-09-01', to: '2026-09-30' },
        }),
        validateFilters: (input) => ({
          ...input,
          keyword: input.keyword.trim(),
        }),
      },
    )
    vm.filterInput.value.keyword = ' buyer '
    await vm.submitSearch()
    vm.filterInput.value.keyword = 'unsubmitted'
    vm.filterInput.value.businessDate.from = '2026-10-01'
    vm.filterInput.value.enabled = false
    expect(vm.appliedQuery.value).toEqual({
      keyword: 'buyer',
      enabled: true,
      businessDate: { from: '2026-09-01', to: '2026-09-30' },
      page: 1,
    })

    await vm.goToPage(2)
    await vm.edit(item('u1'))

    expect(onSearch).toHaveBeenNthCalledWith(2, {
      keyword: 'buyer',
      enabled: true,
      businessDate: { from: '2026-09-01', to: '2026-09-30' },
      page: 2,
      pageSize: 20,
    })
    expect(onSearch).toHaveBeenNthCalledWith(3, {
      keyword: 'buyer',
      enabled: true,
      businessDate: { from: '2026-09-01', to: '2026-09-30' },
      page: 2,
      pageSize: 20,
    })
    expect(onSearch).toHaveBeenCalledTimes(3)
    expect(vm.feedback.value).toBe('操作成功。')
  })

  it('preserves confirmed write success when refresh fails and blocks a duplicate row write', async () => {
    const write = deferred<'changed'>()
    const onSearch = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item('u1')],
        total: 1,
        page: 1,
        pageSize: 20,
      })
      .mockRejectedValueOnce(new Error('offline'))
    const onDisable = vi.fn().mockReturnValue(write.promise)
    const vm = useListPageViewModel<Item>({ onSearch, onDisable })
    await vm.initialize()

    const first = vm.disable(item('u1'))
    const duplicate = vm.disable(item('u1'))
    expect(vm.isRowPending('u1')).toBe(true)
    write.resolve('changed')
    await Promise.all([first, duplicate])

    expect(onDisable).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenCalledTimes(2)
    expect(vm.feedback.value).toBe('操作已成功，但列表刷新失败。')
    expect(vm.queryError.value).toBe('offline')
    expect(vm.items.value.map(({ id }) => id)).toEqual(['u1'])
    expect(vm.isRowPending('u1')).toBe(false)
    expect(vm.isRowBlocked('u1')).toBe(true)

    await vm.disable(item('u1'))
    expect(onDisable).toHaveBeenCalledTimes(1)

    onSearch.mockResolvedValueOnce({
      items: [{ ...item('u1'), enabled: false, revision: '2' }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    await vm.submitSearch()
    expect(vm.isRowBlocked('u1')).toBe(false)
  })

  it('keeps an unresolved mutation locked after an ordinary query', async () => {
    const onSearch = vi.fn().mockResolvedValue({
      items: [item('u1')],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const onDisable = vi
      .fn()
      .mockRejectedValue(
        new ListActionUnresolvedError('请求结果未知，请先刷新后再操作。'),
      )
    const vm = useListPageViewModel<Item>({ onSearch, onDisable })
    await vm.initialize()

    await vm.disable(item('u1'))
    await vm.disable(item('u1'))

    expect(onDisable).toHaveBeenCalledTimes(1)
    expect(vm.isRowBlocked('u1')).toBe(true)
    expect(vm.feedback.value).toContain('结果未知')

    await vm.submitSearch()
    expect(vm.isRowBlocked('u1')).toBe(true)
  })

  it('allows a confirmed row conflict to be retried after a query refresh', async () => {
    const onSearch = vi.fn().mockResolvedValue({
      items: [item('u1')],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const onDisable = vi
      .fn()
      .mockRejectedValueOnce(
        new ListActionRefreshRequiredError('数据已变化，请刷新后重试。'),
      )
      .mockResolvedValueOnce('changed')
    const vm = useListPageViewModel<Item>({ onSearch, onDisable })
    await vm.initialize()

    await vm.disable(item('u1'))
    expect(vm.isRowBlocked('u1')).toBe(true)
    expect(onDisable).toHaveBeenCalledTimes(1)

    await vm.submitSearch()
    expect(vm.isRowBlocked('u1')).toBe(false)

    await vm.disable(item('u1'))
    expect(onDisable).toHaveBeenCalledTimes(2)
  })

  it('keeps an unresolved create locked after an ordinary query', async () => {
    const onSearch = vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    const onCreate = vi
      .fn()
      .mockRejectedValue(
        new ListActionUnresolvedError('请求结果未知，请先刷新后再操作。'),
      )
    const vm = useListPageViewModel<Item>({ onSearch, onCreate })
    await vm.initialize()

    await vm.create()
    await vm.submitSearch()
    await vm.create()

    expect(vm.actionBlocked.value).toBe(true)
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('blocks another create after confirmed success when its list refresh fails', async () => {
    const onSearch = vi
      .fn()
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      })
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce({
        items: [item('created')],
        total: 1,
        page: 1,
        pageSize: 20,
      })
    const onCreate = vi.fn().mockResolvedValue('changed' as const)
    const vm = useListPageViewModel<Item>({ onSearch, onCreate })
    await vm.initialize()

    await vm.create()
    await vm.create()

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(vm.actionBlocked.value).toBe(true)
    expect(vm.feedback.value).toBe('操作已成功，但列表刷新失败。')

    await vm.submitSearch()
    expect(vm.actionBlocked.value).toBe(false)
  })

  it('does not announce or refresh cancelled editors and ignores late work after disposal', async () => {
    const late = deferred<{
      items: Item[]
      total: number
      page: number
      pageSize: number
    }>()
    const onSearch = vi.fn().mockReturnValue(late.promise)
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const vm = useListPageViewModel<Item>({ onSearch, onCreate })

    const query = vm.initialize()
    await vm.create()
    vm.dispose()
    late.resolve({
      items: [item('late')],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    await query

    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(vm.feedback.value).toBeNull()
    expect(vm.items.value).toEqual([])
  })
})
