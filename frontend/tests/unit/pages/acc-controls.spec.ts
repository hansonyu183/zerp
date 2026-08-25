import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { createAccountingMappingViewModel } from '@/pages/acc/mapping/vm'
import mappingSource from '@/pages/acc/mapping/Mapping.vue?raw'
import { createAccountingOpeningViewModel } from '@/pages/acc/opening/vm'
import openingSource from '@/pages/acc/opening/Opening.vue?raw'
import {
  accountingMonthHasEnded,
  createAccountingPeriodViewModel,
} from '@/pages/acc/period/vm'
import periodSource from '@/pages/acc/period/Period.vue?raw'
import { createAccountingSubjectViewModel } from '@/pages/acc/subject/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

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
      }) as ReturnType<typeof apiClient.postContract>,
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

  it('never shows mappings from the previous book after a query failure', async () => {
    useSessionStore().permissions = ['/acc/book/query', '/acc/mapping/query']
    mockedPost.mockRejectedValueOnce(new Error('target book failed'))
    const vm = createAccountingMappingViewModel()
    vm.selectedBookId = '01JACC00000000000000000001'
    vm.rows = [{ mappingId: 'old-book-mapping' }] as typeof vm.rows
    vm.total = 1

    await vm.changeBook('01JACC00000000000000000002')

    expect(vm.selectedBookId).toBe('01JACC00000000000000000002')
    expect(vm.rows).toEqual([])
    expect(vm.total).toBe(0)
    expect(vm.errorMessage).toBeTruthy()
  })

  it('resets mapping list filters through the shared filter controls', async () => {
    useSessionStore().permissions = ['/acc/book/query', '/acc/mapping/query']
    mockedPost.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const vm = createAccountingMappingViewModel()
    vm.selectedBookId = '01JACC00000000000000000001'
    vm.entityFilter = 'sale-order'
    vm.page = 3

    await vm.resetFilters()

    expect(vm.entityFilter).toBe('')
    expect(vm.page).toBe(1)
    expect(mockedPost).toHaveBeenLastCalledWith('acc/mapping/query', {
      bookId: '01JACC00000000000000000001',
      page: 1,
      pageSize: 20,
    })
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

  it('only enables locking after the target natural month has ended', () => {
    const now = new Date('2026-08-14T10:00:00+08:00')
    expect(accountingMonthHasEnded('2026-07', now)).toBe(true)
    expect(accountingMonthHasEnded('2026-08', now)).toBe(false)
    expect(accountingMonthHasEnded('2026-09', now)).toBe(false)
  })

  it('uses the Shanghai business month at the month-end boundary', () => {
    expect(
      accountingMonthHasEnded('2026-08', new Date('2026-08-31T15:59:59.999Z')),
    ).toBe(false)
    expect(
      accountingMonthHasEnded('2026-08', new Date('2026-08-31T16:00:00Z')),
    ).toBe(true)
  })

  it('requires complete query permissions for subject mutations', () => {
    const session = useSessionStore()
    session.permissions = [
      '/acc/subject/create',
      '/acc/subject/get',
      '/acc/subject/save',
      '/acc/subject/delete',
    ]
    const vm = createAccountingSubjectViewModel()
    vm.selectedBookId = '01JACC00000000000000000001'
    const subject = { referenced: false, leaf: true } as Parameters<
      typeof vm.canDelete
    >[0]
    expect(vm.canCreate).toBe(false)
    expect(vm.canEdit).toBe(false)
    expect(vm.canDelete(subject)).toBe(false)

    session.permissions.push('/acc/book/query', '/acc/subject/query')
    expect(vm.canCreate).toBe(true)
    expect(vm.canEdit).toBe(true)
    expect(vm.canDelete(subject)).toBe(true)
  })

  it('requires complete query permissions for opening mutations', () => {
    const session = useSessionStore()
    session.permissions = [
      '/acc/opening/save',
      '/acc/opening/approve',
      '/acc/opening/unapprove',
    ]
    const vm = createAccountingOpeningViewModel()
    vm.opening = {
      state: 'DRAFT',
      trialBalance: [],
    } as typeof vm.opening
    expect(vm.canSave).toBe(false)
    expect(vm.canApprove).toBe(false)

    session.permissions.push(
      '/acc/book/query',
      '/acc/subject/query',
      '/acc/opening/query',
    )
    expect(vm.canSave).toBe(true)
    expect(vm.canApprove).toBe(true)

    vm.opening = { state: 'APPROVED' } as typeof vm.opening
    expect(vm.canUnapprove).toBe(true)
    session.permissions = session.permissions.filter(
      (permission) => permission !== '/acc/subject/query',
    )
    expect(vm.canUnapprove).toBe(false)
  })

  it('uses labeled phone cards for ACC tables', () => {
    for (const source of [openingSource, periodSource]) {
      expect(source).toContain('@media (max-width: 700px)')
      expect(source).toContain('content: attr(data-label)')
    }
    expect(openingSource).not.toContain('overflow-x-auto')
    expect(mappingSource).toContain(':mobile-breakpoint="700"')
    expect(mappingSource).toContain('<EntityListControls')
    expect(mappingSource).toContain('<ListRowActions')
  })
})
