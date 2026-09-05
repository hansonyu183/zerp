import { describe, expect, it, vi } from 'vitest'

import { createAccPeriodViewModel } from '@/target/pages/acc/period/vm.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function ports() {
  return {
    books: vi.fn().mockResolvedValue({
      items: [
        {
          id: '01K4A000000000000000000001',
          code: 'ACC-0001',
          name: '控制账簿',
          description: '',
          startMonth: '2026-08',
          baseCurrency: 'CNY',
          controlBook: true,
          revision: '1',
          queryUserIds: [],
          operateUserIds: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 200,
    }),
    query: vi.fn().mockResolvedValue([
      {
        bookId: '01K4A000000000000000000001',
        month: '2026-08',
        locked: true,
        revision: '2',
      },
    ]),
    set: vi.fn().mockResolvedValue({
      bookId: '01K4A000000000000000000001',
      month: '2026-09',
      locked: true,
      revision: '1',
    }),
  }
}

describe('ACC period public view-model seam', () => {
  it('keeps only the latest selected-book period list', async () => {
    const api = ports()
    const previous = deferred<Awaited<ReturnType<typeof api.query>>>()
    api.query.mockReturnValueOnce(previous.promise).mockResolvedValueOnce([
      {
        bookId: '01K4A000000000000000000002',
        month: '2026-09',
        locked: false,
        revision: '1',
      },
    ])
    const vm = createAccPeriodViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/acc/book/query', '/acc/period/query'],
        today: '2026-10-05',
      },
      api,
    )
    vm.selectedBookId.value = '01K4A000000000000000000001'

    const oldQuery = vm.query()
    await vm.selectBook('01K4A000000000000000000002')
    previous.resolve([
      {
        bookId: '01K4A000000000000000000001',
        month: '2026-08',
        locked: true,
        revision: '2',
      },
    ])
    await oldQuery

    expect(vm.periods.value[0]?.bookId).toBe('01K4A000000000000000000002')
  })

  it('locks only the next ended natural month with its current revision', async () => {
    const api = ports()
    const vm = createAccPeriodViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/period/query',
          '/acc/period/lock',
        ],
        today: '2026-10-05',
      },
      api,
    )
    await vm.initialize()
    await vm.lock()

    expect(vm.nextLockMonth.value).toBe('2026-09')
    expect(api.set).toHaveBeenCalledWith('csrf-token', 'lock', {
      bookId: '01K4A000000000000000000001',
      month: '2026-09',
      expectedRevision: null,
    })
  })

  it('refreshes and preserves the server error after a failed period action', async () => {
    const api = ports()
    api.set.mockRejectedValue(new Error('期间仍有未完成单据'))
    const vm = createAccPeriodViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/period/query',
          '/acc/period/unlock',
        ],
        today: '2026-10-05',
      },
      api,
    )
    await vm.initialize()
    await vm.unlock()

    expect(api.query).toHaveBeenCalledTimes(2)
    expect(vm.error.value).toBe('期间仍有未完成单据')
  })
})
