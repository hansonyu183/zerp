import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useSessionStore } from '@/stores/session'
import { createAccountingBookViewModel } from '@/pages/acc/book/vm'

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

const mockedPost = vi.mocked(apiClient.post)

const controlBook = {
  bookId: '01JACC00000000000000000001',
  code: 'MAIN',
  name: '管理账簿',
  description: '内部管理',
  startMonth: '2026-08',
  baseCurrency: 'CNY',
  subjectTemplate: 'ENTERPRISE' as const,
  controlBook: true,
  revision: 1,
  queryUserIds: ['01JACC00000000000000000002'],
  operateUserIds: ['01JACC00000000000000000003'],
}

describe('ACC accounting book view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('queries only books visible through the ACC query contract', async () => {
    useSessionStore().permissions = ['/acc/book/query']
    mockedPost.mockResolvedValue({
      data: { items: [controlBook], total: 1, page: 1, pageSize: 20 },
    })
    const vm = createAccountingBookViewModel()

    await vm.query()

    expect(mockedPost).toHaveBeenCalledWith('acc/book/query', {
      page: 1,
      pageSize: 20,
    })
    expect(vm.rows).toEqual([controlBook])
    expect(vm.canDelete(controlBook)).toBe(false)
  })

  it('requires the complete permissions needed to configure access scopes', async () => {
    const session = useSessionStore()
    session.permissions = [
      '/acc/book/create',
      '/acc/book/get',
      '/acc/book/save',
    ]
    const vm = createAccountingBookViewModel()
    expect(vm.canCreate).toBe(false)
    expect(vm.canEdit).toBe(false)

    session.permissions.push('/app/user/query')
    expect(vm.canCreate).toBe(false)
    expect(vm.canEdit).toBe(false)

    session.permissions.push('/acc/book/query')
    expect(vm.canCreate).toBe(true)
    expect(vm.canEdit).toBe(true)

    mockedPost.mockResolvedValue({
      data: {
        items: [
          {
            id: '01JACC00000000000000000002',
            username: 'query-user',
            displayName: '查询人员',
            status: 'ENABLED',
            revision: 1,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 200,
      },
    })
    await vm.openCreate()
    expect(vm.userOptions).toEqual([
      {
        title: 'query-user · 查询人员',
        value: '01JACC00000000000000000002',
      },
    ])
  })

  it('ignores query results that arrive after the owning scope is disposed', async () => {
    useSessionStore().permissions = ['/acc/book/query']
    let resolveQuery: ((value: unknown) => void) | undefined
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve
      }) as ReturnType<typeof apiClient.post>,
    )
    const scope = effectScope()
    const vm = scope.run(() => createAccountingBookViewModel())!
    const pending = vm.query()

    scope.stop()
    resolveQuery?.({
      data: { items: [controlBook], total: 1, page: 1, pageSize: 20 },
    })
    await pending

    expect(vm.rows).toEqual([])
    expect(vm.total).toBe(0)
  })

  it('creates a book with separate query and operation ranges', async () => {
    useSessionStore().permissions = [
      '/acc/book/create',
      '/app/user/query',
      '/acc/book/query',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 200 },
      })
      .mockResolvedValueOnce({ data: controlBook })
      .mockResolvedValueOnce({
        data: { items: [controlBook], total: 1, page: 1, pageSize: 20 },
      })
    const vm = createAccountingBookViewModel()
    await vm.openCreate()
    vm.form.name = ' 管理账簿 '
    vm.form.description = ' 内部管理 '
    vm.form.startMonth = '2026-08'
    vm.form.baseCurrency = 'cny'
    vm.form.queryUserIds = ['01JACC00000000000000000002']
    vm.form.operateUserIds = ['01JACC00000000000000000003']

    await vm.save()

    expect(mockedPost).toHaveBeenNthCalledWith(2, 'acc/book/create', {
      name: '管理账簿',
      description: '内部管理',
      startMonth: '2026-08',
      baseCurrency: 'CNY',
      subjectTemplate: 'ENTERPRISE',
      queryUserIds: ['01JACC00000000000000000002'],
      operateUserIds: ['01JACC00000000000000000003'],
    })
  })
})
