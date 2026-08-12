import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { createAccountingMappingViewModel } from '@/pages/acc/mapping/vm'
import mappingSource from '@/pages/acc/mapping/Mapping.vue?raw'
import openingSource from '@/pages/acc/opening/Opening.vue?raw'
import { createAccountingPeriodViewModel } from '@/pages/acc/period/vm'
import periodSource from '@/pages/acc/period/Period.vue?raw'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.post)

describe('ACC mapping and period controls', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('requires complete query and reference permissions for mapping actions', () => {
    const session = useSessionStore()
    session.permissions = [
      '/acc/book/query',
      '/acc/mapping/query',
      '/acc/mapping/create',
    ]
    const vm = createAccountingMappingViewModel()
    vm.selectedBookId = '01JACC00000000000000000001'
    expect(vm.canCreate).toBe(false)

    session.permissions.push('/acc/mapping/catalog')
    expect(vm.canCreate).toBe(true)
    expect(vm.canEdit).toBe(false)

    session.permissions.push('/acc/mapping/get', '/acc/mapping/save')
    expect(vm.canEdit).toBe(true)
  })

  it('ignores mapping list responses after scope disposal', async () => {
    useSessionStore().permissions = ['/acc/book/query', '/acc/mapping/query']
    let resolveQuery: ((value: unknown) => void) | undefined
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve
      }) as ReturnType<typeof apiClient.post>,
    )
    const scope = effectScope()
    const vm = scope.run(() => createAccountingMappingViewModel())!
    vm.selectedBookId = '01JACC00000000000000000001'
    const pending = vm.query()
    scope.stop()
    resolveQuery?.({
      data: {
        items: [{ mappingId: 'ignored' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await pending
    expect(vm.rows).toEqual([])
  })

  it('requires query permission for period mutations', () => {
    const session = useSessionStore()
    session.permissions = ['/acc/period/lock', '/acc/period/unlock']
    const vm = createAccountingPeriodViewModel()
    expect(vm.canLock).toBe(false)
    expect(vm.canUnlock).toBe(false)
    session.permissions.push('/acc/book/query', '/acc/period/query')
    expect(vm.canLock).toBe(true)
    expect(vm.canUnlock).toBe(true)
  })

  it('uses labeled phone cards for ACC tables', () => {
    for (const source of [openingSource, periodSource]) {
      expect(source).toContain('@media (max-width: 700px)')
      expect(source).toContain('content: attr(data-label)')
    }
    expect(openingSource).not.toContain('overflow-x-auto')
    expect(mappingSource).toContain(':mobile-breakpoint="700"')
  })
})
