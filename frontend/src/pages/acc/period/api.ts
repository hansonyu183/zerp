import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type AccountingPeriod = components['schemas']['Period']

export function queryAccountingPeriods(bookId: string) {
  return apiClient.post<AccountingPeriod[], { bookId: string }>(
    'acc/period/query',
    { bookId },
  )
}

export function lockAccountingPeriod(
  bookId: string,
  month: string,
  revision: number,
) {
  return apiClient.post<
    AccountingPeriod,
    { bookId: string; month: string; revision: number }
  >('acc/period/lock', { bookId, month, revision })
}

export function unlockAccountingPeriod(
  bookId: string,
  month: string,
  revision: number,
) {
  return apiClient.post<
    AccountingPeriod,
    { bookId: string; month: string; revision: number }
  >('acc/period/unlock', { bookId, month, revision })
}
