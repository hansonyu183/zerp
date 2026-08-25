import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

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
  return apiClient.postContract(
    'acc/subject/query',
    input,
  )
}

export function getAccountingSubject(bookId: string, subjectId: string) {
  return apiClient.postContract('acc/subject/get', { bookId, subjectId })
}

export function createAccountingSubject(input: AccountingSubjectCreate) {
  return apiClient.postContract(
    'acc/subject/create',
    input,
  )
}

export function saveAccountingSubject(input: AccountingSubjectSave) {
  return apiClient.postContract(
    'acc/subject/save',
    input,
  )
}

export function deleteAccountingSubject(
  bookId: string,
  subjectId: string,
  revision: number,
) {
  return apiClient.postContract('acc/subject/delete', { bookId, subjectId, revision })
}
