import { computed, ref } from 'vue'

import {
  queryTargetAccBooks,
  queryTargetAccPeriods,
  setTargetAccPeriod,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import type { AccBook } from '../book/vm.ts'

export type AccPeriod = Awaited<ReturnType<typeof setTargetAccPeriod>>

export interface AccPeriodViewModelContext {
  csrfToken: string
  permissions: readonly string[]
  today: string
}

export interface AccPeriodViewModelPorts {
  books(
    csrfToken: string,
    input: { page: 1; pageSize: 200 },
  ): Promise<{
    items: AccBook[]
    total: number
    page: number
    pageSize: number
  }>
  query(csrfToken: string, bookId: string): Promise<AccPeriod[]>
  set(
    csrfToken: string,
    action: 'lock' | 'unlock',
    input: { bookId: string; month: string; expectedRevision: string | null },
  ): Promise<AccPeriod>
}

export function createAccPeriodViewModel(
  context: AccPeriodViewModelContext,
  ports: AccPeriodViewModelPorts,
) {
  const books = ref<AccBook[]>([])
  const periods = ref<AccPeriod[]>([])
  const selectedBookId = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)
  let queryVersion = 0

  const canQuery = computed(
    () =>
      context.permissions.includes('/acc/book/query') &&
      context.permissions.includes('/acc/period/query'),
  )
  const canLock = computed(
    () => canQuery.value && context.permissions.includes('/acc/period/lock'),
  )
  const canUnlock = computed(
    () => canQuery.value && context.permissions.includes('/acc/period/unlock'),
  )
  const bookOptions = computed(() =>
    books.value.map((book) => ({
      title: `${book.code} · ${book.name}`,
      value: book.id,
    })),
  )
  const selectedBook = computed(() =>
    books.value.find((book) => book.id === selectedBookId.value),
  )
  const lockedPeriods = computed(() =>
    periods.value
      .filter((period) => period.locked)
      .sort((left, right) => right.month.localeCompare(left.month)),
  )
  const latestLocked = computed(() => lockedPeriods.value[0] ?? null)
  const nextLockMonth = computed(() =>
    latestLocked.value
      ? nextMonth(latestLocked.value.month)
      : (selectedBook.value?.startMonth ?? ''),
  )
  const nextLockEnded = computed(
    () =>
      !!nextLockMonth.value && nextLockMonth.value < context.today.slice(0, 7),
  )
  const lockDisabledReason = computed(() =>
    nextLockEnded.value
      ? ''
      : nextLockMonth.value
        ? `${nextLockMonth.value} 尚未结束，自然月结束后才能锁定。`
        : '没有可锁定的会计期间。',
  )

  async function initialize(): Promise<void> {
    if (!canQuery.value) return
    loading.value = true
    try {
      const result = await ports.books(context.csrfToken, {
        page: 1,
        pageSize: 200,
      })
      books.value = result.items
      selectedBookId.value ||= books.value[0]?.id ?? ''
      await query()
    } catch (cause) {
      error.value = errorMessage(cause, '会计期间初始化失败。')
    } finally {
      loading.value = false
    }
  }

  async function query(): Promise<void> {
    if (!selectedBookId.value || !canQuery.value) return
    const version = ++queryVersion
    const bookId = selectedBookId.value
    try {
      const result = await ports.query(context.csrfToken, bookId)
      if (version !== queryVersion || bookId !== selectedBookId.value) return
      periods.value = result
      error.value = null
    } catch (cause) {
      if (version === queryVersion && bookId === selectedBookId.value)
        error.value = errorMessage(cause, '会计期间查询失败。')
    }
  }

  async function selectBook(bookId: string): Promise<void> {
    selectedBookId.value = bookId
    await query()
  }

  async function lock(): Promise<void> {
    if (!canLock.value || !selectedBookId.value || !nextLockMonth.value) {
      error.value = '没有权限锁定会计期间。'
      return
    }
    if (!nextLockEnded.value) {
      error.value = lockDisabledReason.value
      return
    }
    await setPeriod(
      'lock',
      nextLockMonth.value,
      periods.value.find((period) => period.month === nextLockMonth.value)
        ?.revision ?? null,
    )
  }

  async function unlock(): Promise<void> {
    if (!canUnlock.value || !latestLocked.value) {
      error.value = '没有权限解锁会计期间。'
      return
    }
    await setPeriod(
      'unlock',
      latestLocked.value.month,
      latestLocked.value.revision,
    )
  }

  async function setPeriod(
    action: 'lock' | 'unlock',
    month: string,
    expectedRevision: string | null,
  ): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await ports.set(context.csrfToken, action, {
        bookId: selectedBookId.value,
        month,
        expectedRevision,
      })
      await query()
      message.value =
        action === 'lock' ? `已锁定 ${month}。` : `已解锁 ${month}。`
    } catch (cause) {
      const failure = errorMessage(cause, '会计期间操作失败。')
      await query()
      error.value = failure
    } finally {
      saving.value = false
    }
  }

  return {
    books,
    periods,
    selectedBookId,
    loading,
    saving,
    error,
    message,
    canQuery,
    canLock,
    canUnlock,
    bookOptions,
    latestLocked,
    nextLockMonth,
    nextLockEnded,
    lockDisabledReason,
    initialize,
    query,
    selectBook,
    lock,
    unlock,
  }
}

export function useAccPeriodViewModel() {
  const session = useTargetSession()
  if (!session.csrfToken)
    throw new Error('Accounting period page requires an authenticated session.')
  return createAccPeriodViewModel(
    {
      csrfToken: session.csrfToken,
      permissions: session.permissions,
      today: shanghaiDate(new Date()),
    },
    {
      books: queryTargetAccBooks,
      query: (csrfToken, bookId) =>
        queryTargetAccPeriods(csrfToken, { bookId }),
      set: setTargetAccPeriod,
    },
  )
}

function nextMonth(month: string): string {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year!, value!, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function shanghaiDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
