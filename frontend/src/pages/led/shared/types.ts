import type { BobApiEntity } from '@/api/client'

export type LedgerEntity =
  | 'inventory'
  | 'fund'
  | 'customer'
  | 'supplier'
  | 'other'
  | 'container'
export type LedgerMode = 'entries' | 'balances'
export type LedgerRecord = Record<string, unknown>

export interface LedgerReferenceInput {
  objectId: string
  versionId: string
}

export interface LedgerReference extends LedgerReferenceInput {
  entity: BobApiEntity
  code: string
  name: string
  unit?: string
  currency?: string
}

export interface LedgerPage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface LedgerColumn {
  key: string
  label: string
  value: (row: LedgerRecord) => unknown
  align?: 'start' | 'center' | 'end'
  width?: string
}

export interface LedgerOption {
  title: string
  value: string
}

export interface LedgerReferenceSource {
  entity: BobApiEntity
  filters?: Record<string, unknown>
}

export interface LedgerEntityConfig {
  entity: LedgerEntity
  title: string
  objectLabel: string
  referenceSources: readonly LedgerReferenceSource[]
  sourceEntities: readonly LedgerOption[]
  directions: readonly LedgerOption[]
  counterpartyTypes?: readonly LedgerOption[]
  otherCategories?: readonly LedgerOption[]
  entryColumns: readonly LedgerColumn[]
  balanceColumns: readonly LedgerColumn[]
}

export interface LedgerQueryFilters {
  dateFrom: string
  dateTo: string
  object: LedgerReference | null
  sourceEntity: string
  documentNo: string
  direction: string[]
  counterpartyType: string
  otherCategory: string
}

export interface LedgerBalanceFilters {
  asOfDate: string
  object: LedgerReference | null
  counterpartyType: string
}

export interface LedgerSort {
  field: 'effectiveDate' | 'occurredAt' | 'documentNo'
  order: 'asc' | 'desc'
}

export interface LedgerReferenceSearch {
  options: LedgerReference[]
  loading: boolean
  errorMessage: string | null
  search: (keyword: string) => void
  dispose: () => void
}
