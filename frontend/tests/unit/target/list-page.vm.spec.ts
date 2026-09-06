import { describe, expect, it, vi } from 'vitest'

import {
  ListActionUnresolvedError,
  useListPageViewModel,
  type EnabledListItem,
} from '@/target/components/list-page/vm.ts'

type Item = EnabledListItem & { revision: string }

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

    searchable.keyword.value = ' 未提交 '
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
    vm.keyword.value = 'new'
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

  it('uses the submitted keyword for paging and exactly one post-change refresh', async () => {
    const onSearch = vi.fn().mockResolvedValue({
      items: [item('u1')],
      total: 21,
      page: 1,
      pageSize: 20,
    })
    const onEdit = vi.fn().mockResolvedValue('changed' as const)
    const vm = useListPageViewModel<Item>({ onSearch, onEdit })
    vm.keyword.value = 'buyer'
    await vm.submitSearch()
    vm.keyword.value = 'unsubmitted'

    await vm.goToPage(2)
    await vm.edit(item('u1'))

    expect(onSearch).toHaveBeenNthCalledWith(2, {
      keyword: 'buyer',
      page: 2,
      pageSize: 20,
    })
    expect(onSearch).toHaveBeenNthCalledWith(3, {
      keyword: 'buyer',
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

  it('keeps an unresolved mutation locked until a later explicit query establishes fresh facts', async () => {
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
    expect(vm.isRowBlocked('u1')).toBe(false)
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
