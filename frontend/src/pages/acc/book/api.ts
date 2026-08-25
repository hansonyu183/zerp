import { apiClient, type ApiPostRequest } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type AccountingBook = components['schemas']['Book']
export type AccountingBookCreate = components['schemas']['BookCreateRequest']
export type AccountingBookSave = components['schemas']['BookSaveRequest']

export type AccessUser = components['schemas']['UserListItem']

export function queryAccountingBooks(input: {
  page: number
  pageSize: number
  keyword?: string
}) {
  return apiClient.postContract(
    'acc/book/query',
    input,
  )
}

export function getAccountingBook(bookId: string) {
  return apiClient.postContract('acc/book/get', {
    bookId,
  })
}

export function createAccountingBook(input: AccountingBookCreate) {
  return apiClient.postContract(
    'acc/book/create',
    input,
  )
}

export function saveAccountingBook(input: AccountingBookSave) {
  return apiClient.postContract(
    'acc/book/save',
    input,
  )
}

export function deleteAccountingBook(bookId: string, revision: number) {
  return apiClient.postContract(
    'acc/book/delete',
    { bookId, revision },
  )
}

export function queryAccessUsers(input: ApiPostRequest<'app/user/query'>) {
  return apiClient.postContract(
    'app/user/query',
    input,
  )
}
