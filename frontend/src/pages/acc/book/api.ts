import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import type { PageRequest, PageResult } from '@/api/types'

export type AccountingBook = components['schemas']['Book']
export type AccountingBookCreate = components['schemas']['BookCreateRequest']
export type AccountingBookSave = components['schemas']['BookSaveRequest']

export interface AccessUser {
  id: string
  username: string
  displayName: string
  status: 'ENABLED' | 'DISABLED'
}

export function queryAccountingBooks(input: {
  page: number
  pageSize: number
  keyword?: string
}) {
  return apiClient.post<PageResult<AccountingBook>, typeof input>(
    'acc/book/query',
    input,
  )
}

export function getAccountingBook(bookId: string) {
  return apiClient.post<AccountingBook, { bookId: string }>('acc/book/get', {
    bookId,
  })
}

export function createAccountingBook(input: AccountingBookCreate) {
  return apiClient.post<AccountingBook, AccountingBookCreate>(
    'acc/book/create',
    input,
  )
}

export function saveAccountingBook(input: AccountingBookSave) {
  return apiClient.post<AccountingBook, AccountingBookSave>(
    'acc/book/save',
    input,
  )
}

export function deleteAccountingBook(bookId: string, revision: number) {
  return apiClient.post<null, { bookId: string; revision: number }>(
    'acc/book/delete',
    { bookId, revision },
  )
}

export function queryAccessUsers(input: PageRequest) {
  return apiClient.post<PageResult<AccessUser>, PageRequest>(
    'app/user/query',
    input,
  )
}
