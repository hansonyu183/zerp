import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type AccountingOpening = components['schemas']['Opening']
export type AccountingOpeningLineInput =
  components['schemas']['OpeningLineInput']

export function queryAccountingOpening(bookId: string) {
  return apiClient.post<AccountingOpening, { bookId: string }>(
    'acc/opening/query',
    { bookId },
  )
}

export function saveAccountingOpening(input: {
  bookId: string
  revision: number
  lines: AccountingOpeningLineInput[]
}) {
  return apiClient.post<AccountingOpening, typeof input>(
    'acc/opening/save',
    input,
  )
}

export function approveAccountingOpening(bookId: string, revision: number) {
  return apiClient.post<
    AccountingOpening,
    { bookId: string; revision: number }
  >('acc/opening/approve', { bookId, revision })
}

export function unapproveAccountingOpening(bookId: string, revision: number) {
  return apiClient.post<
    AccountingOpening,
    { bookId: string; revision: number }
  >('acc/opening/unapprove', { bookId, revision })
}
