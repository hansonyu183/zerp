import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type AccountingOpening = components['schemas']['Opening']
export type AccountingOpeningLineInput =
  components['schemas']['OpeningLineInput']
export type AccountingOpeningSaveInput =
  components['schemas']['OpeningSaveRequest']

export function queryAccountingOpening(bookId: string) {
  return apiClient.postContract(
    'acc/opening/query',
    { bookId },
  )
}

export function saveAccountingOpening(input: AccountingOpeningSaveInput) {
  return apiClient.postContract(
    'acc/opening/save',
    input,
  )
}

export function approveAccountingOpening(bookId: string, revision: number) {
  return apiClient.postContract('acc/opening/approve', { bookId, revision })
}

export function unapproveAccountingOpening(bookId: string, revision: number) {
  return apiClient.postContract('acc/opening/unapprove', { bookId, revision })
}
