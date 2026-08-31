import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type OpeningContract = components['schemas']['Opening']
export type AccountingOpeningLineInput =
  components['schemas']['OpeningLineInput']
export type AccountingOpeningSaveInput =
  components['schemas']['OpeningSaveRequest']

export function queryAccountingOpening(bookId: string) {
  return apiClient.postContract('acc/opening/query', { bookId })
}

export function saveAccountingOpening(input: AccountingOpeningSaveInput) {
  return apiClient.postContract('acc/opening/save', input)
}

export function openingApprovalAction(
  action: 'submit' | 'unsubmit' | 'approve',
  bookId: string,
  revision: number,
) {
  return apiClient.postContract(`acc/opening/${action}`, { bookId, revision })
}

export function openingReasonAction(
  action: 'reject' | 'unapprove',
  bookId: string,
  revision: number,
  reason: string,
) {
  return apiClient.postContract(`acc/opening/${action}`, {
    bookId,
    revision,
    reason,
  })
}
