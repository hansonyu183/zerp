import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { queryAccountingBooks, type AccountingBook } from '../book/api'
import {
  lockAccountingPeriod,
  queryAccountingPeriods,
  unlockAccountingPeriod,
  type AccountingPeriod,
} from './api'

function nextMonth(month: string): string {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year!, value!, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function accountingMonthHasEnded(
  month: string,
  now = new Date(),
): boolean {
  if (!/^\d{4}-\d{2}$/.test(month)) return false
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return month < currentMonth
}

export function createAccountingPeriodViewModel() {
  const session = useSessionStore()
  const books = ref<AccountingBook[]>([])
  const periods = ref<AccountingPeriod[]>([])
  const selectedBookId = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  let sequence = 0
  let active = true
  if (getCurrentScope()) {
    onScopeDispose(() => {
      active = false
      sequence += 1
    })
  }

  const canQuery = computed(
    () => session.can('/acc/book/query') && session.can('/acc/period/query'),
  )
  const canLock = computed(
    () => canQuery.value && session.can('/acc/period/lock'),
  )
  const canUnlock = computed(
    () => canQuery.value && session.can('/acc/period/unlock'),
  )
  const selectedBook = computed(() =>
    books.value.find((book) => book.bookId === selectedBookId.value),
  )
  const latestLocked = computed(() =>
    periods.value.find((period) => period.state === 'LOCKED'),
  )
  const nextLockMonth = computed(() =>
    latestLocked.value
      ? nextMonth(latestLocked.value.month)
      : (selectedBook.value?.startMonth ?? ''),
  )
  const nextLockRevision = computed(
    () =>
      periods.value.find((period) => period.month === nextLockMonth.value)
        ?.revision ?? 0,
  )
  const nextLockMonthEnded = computed(() =>
    accountingMonthHasEnded(nextLockMonth.value),
  )
  const lockDisabledReason = computed(() => {
    if (!nextLockMonth.value) return '没有可锁定的会计期间。'
    if (!nextLockMonthEnded.value)
      return `${nextLockMonth.value} 尚未结束，自然月结束后才能锁定。`
    return ''
  })
  const bookOptions = computed(() =>
    books.value.map((book) => ({
      title: `${book.code} · ${book.name}`,
      value: book.bookId,
    })),
  )

  async function loadPeriods(existingSequence?: number): Promise<void> {
    if (!canQuery.value || !selectedBookId.value) {
      periods.value = []
      return
    }
    const current = existingSequence ?? ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryAccountingPeriods(selectedBookId.value)
      if (!active || current !== sequence) return
      periods.value = result.data
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  async function selectBook(bookId: string): Promise<void> {
    selectedBookId.value = bookId
    await loadPeriods()
  }

  async function initialize(): Promise<void> {
    if (!canQuery.value) return
    const current = ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryAccountingBooks({ page: 1, pageSize: 200 })
      if (!active || current !== sequence) return
      books.value = result.data.items
      selectedBookId.value = books.value[0]?.bookId ?? ''
      await loadPeriods(current)
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  async function lock(): Promise<void> {
    if (!canLock.value || !selectedBookId.value || !nextLockMonth.value) {
      errorMessage.value = '没有权限锁定会计期间。'
      return
    }
    if (!nextLockMonthEnded.value) {
      errorMessage.value = lockDisabledReason.value
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      await lockAccountingPeriod(
        selectedBookId.value,
        nextLockMonth.value,
        nextLockRevision.value,
      )
      if (!active) return
      successMessage.value = `已锁定 ${nextLockMonth.value}。`
      await loadPeriods()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function unlock(): Promise<void> {
    if (!canUnlock.value || !selectedBookId.value || !latestLocked.value) {
      errorMessage.value = '没有权限解锁会计期间。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      await unlockAccountingPeriod(
        selectedBookId.value,
        latestLocked.value.month,
        latestLocked.value.revision,
      )
      if (!active) return
      successMessage.value = `已解锁 ${latestLocked.value.month}。`
      await loadPeriods()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  return reactive({
    books,
    periods,
    selectedBookId,
    loading,
    saving,
    errorMessage,
    successMessage,
    canQuery,
    canLock,
    canUnlock,
    latestLocked,
    nextLockMonth,
    nextLockMonthEnded,
    lockDisabledReason,
    bookOptions,
    initialize,
    loadPeriods,
    selectBook,
    lock,
    unlock,
  })
}
