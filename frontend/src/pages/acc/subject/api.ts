import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import type { PageResult } from '@/api/types'

export type AccountingSubject = components['schemas']['Subject']
export type AccountingSubjectCreate =
  components['schemas']['SubjectCreateRequest']
export type AccountingSubjectSave = components['schemas']['SubjectSaveRequest']

export function queryAccountingSubjects(input: {
  bookId: string
  page: number
  pageSize: number
  keyword?: string
}) {
  return apiClient.post<PageResult<AccountingSubject>, typeof input>(
    'acc/subject/query',
    input,
  )
}

export function getAccountingSubject(bookId: string, subjectId: string) {
  return apiClient.post<
    AccountingSubject,
    { bookId: string; subjectId: string }
  >('acc/subject/get', { bookId, subjectId })
}

export function createAccountingSubject(input: AccountingSubjectCreate) {
  return apiClient.post<AccountingSubject, AccountingSubjectCreate>(
    'acc/subject/create',
    input,
  )
}

export function saveAccountingSubject(input: AccountingSubjectSave) {
  return apiClient.post<AccountingSubject, AccountingSubjectSave>(
    'acc/subject/save',
    input,
  )
}

export function deleteAccountingSubject(
  bookId: string,
  subjectId: string,
  revision: number,
) {
  return apiClient.post<
    null,
    { bookId: string; subjectId: string; revision: number }
  >('acc/subject/delete', { bookId, subjectId, revision })
}
