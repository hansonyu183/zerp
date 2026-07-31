import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { auxConfigs } from '@/pages/aux/shared/config'
import { createAuxEntityViewModel } from '@/pages/aux/shared/vm'
import { useSessionStore } from '@/stores/session'

const mockedPost = vi.hoisted(() => vi.fn())

vi.mock('@/api/client', () => ({
  apiClient: { post: mockedPost },
}))

describe('AUX entity view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useSessionStore().permissions = [
      '/aux/position/create',
      '/aux/position/query',
    ]
  })

  it('新增时不展示或提交编码', async () => {
    const vm = createAuxEntityViewModel(auxConfigs.position)
    vm.openCreate()

    expect(vm.editorModel.value.code).toBeUndefined()
    expect(vm.editorFields.value.some((field) => field.key === 'code')).toBe(
      false,
    )

    mockedPost.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    await vm.save({
      ...vm.editorModel.value,
      name: '仓储主管',
      description: '',
    })

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'aux/position/create', {
      data: {
        name: '仓储主管',
        description: '',
      },
    })
  })

  it('按动作权限限制编辑、启停和删除', () => {
    const session = useSessionStore()
    session.permissions = ['/aux/position/query']
    const vm = createAuxEntityViewModel(auxConfigs.position)

    expect(vm.canCreate.value).toBe(false)
    expect(vm.canSave.value).toBe(false)
    expect(vm.canEnable.value).toBe(false)
    expect(vm.canDisable.value).toBe(false)
    expect(vm.canDelete.value).toBe(false)
    vm.openCreate()
    expect(vm.editorOpen.value).toBe(false)

    session.permissions = [
      '/aux/position/query',
      '/aux/position/create',
      '/aux/position/save',
      '/aux/position/enable',
      '/aux/position/disable',
      '/aux/position/delete',
    ]
    expect(vm.canCreate.value).toBe(true)
    expect(vm.canSave.value).toBe(true)
    expect(vm.canEnable.value).toBe(true)
    expect(vm.canDisable.value).toBe(true)
    expect(vm.canDelete.value).toBe(true)
  })

  it('使用编码排序查询完整分页并在重置后恢复升序', async () => {
    mockedPost.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const vm = createAuxEntityViewModel(auxConfigs.position)

    await vm.changeSort({ field: 'code', order: 'desc' })
    expect(mockedPost).toHaveBeenLastCalledWith('aux/position/query', {
      page: 1,
      pageSize: 20,
      filters: {},
      sort: [{ field: 'code', order: 'desc' }],
    })

    await vm.resetFilters()
    expect(vm.sort.value).toEqual({ field: 'code', order: 'asc' })
    expect(mockedPost).toHaveBeenLastCalledWith('aux/position/query', {
      page: 1,
      pageSize: 20,
      filters: {},
      sort: [{ field: 'code', order: 'asc' }],
    })
  })

  it('引用字段使用带关键字的远程查询，不再截断固定前 200 条', async () => {
    vi.useFakeTimers()
    try {
      useSessionStore().permissions = [
        '/aux/department/create',
        '/aux/department/query',
      ]
      mockedPost.mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 100 },
      })
      const vm = createAuxEntityViewModel(auxConfigs.department)

      vm.searchEditorReference('parentId', '华南')
      await vi.advanceTimersByTimeAsync(250)

      expect(mockedPost).toHaveBeenCalledWith('aux/department/query', {
        page: 1,
        pageSize: 100,
        filters: { enabled: true, keyword: '华南' },
        sort: [{ field: 'code', order: 'asc' }],
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
