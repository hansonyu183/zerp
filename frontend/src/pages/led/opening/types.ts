import type { LedgerReference, LedgerReferenceInput } from '@/components/ledger'

export type OpeningStatus = 'DRAFT' | 'ACTIVE' | 'REOPENING'

export interface InventoryOpeningView {
  id: string
  warehouse: LedgerReference
  product: LedgerReference
  quantity: string
  unitPrice?: string
  amount?: string
  currency?: string
}

export interface FundOpeningView {
  id: string
  fundAccount: LedgerReference
  balanceType: 'POSITIVE' | 'OVERDRAFT'
  amount: string
}

export interface PartyOpeningView {
  id: string
  counterpartyType: 'customer' | 'supplier'
  counterparty: LedgerReference
  currency: string
  balanceType: 'RECEIVABLE' | 'PAYABLE'
  amount: string
}

export interface ContainerOpeningView {
  id: string
  customer: LedgerReference
  containerType: 'SOLVENT' | 'RESIN'
  quantity: number
}

export interface OpeningView {
  status: OpeningStatus
  revision: number
  cutoverDate?: string
  activeGenerationId?: string
  inventory: InventoryOpeningView[]
  fund: FundOpeningView[]
  party: PartyOpeningView[]
  container: ContainerOpeningView[]
}

export interface InventoryOpeningDraft {
  key: string
  warehouse: LedgerReference | null
  product: LedgerReference | null
  quantity: string
  unitPrice: string
  currency: string
}

export interface FundOpeningDraft {
  key: string
  fundAccount: LedgerReference | null
  balanceType: 'POSITIVE' | 'OVERDRAFT'
  amount: string
}

export interface PartyOpeningDraft {
  key: string
  counterpartyType: 'customer' | 'supplier'
  counterparty: LedgerReference | null
  currency: string
  balanceType: 'RECEIVABLE' | 'PAYABLE'
  amount: string
}

export interface ContainerOpeningDraft {
  key: string
  customer: LedgerReference | null
  containerType: 'SOLVENT' | 'RESIN'
  quantity: string
}

export interface OpeningForm {
  cutoverDate: string
  inventory: InventoryOpeningDraft[]
  fund: FundOpeningDraft[]
  party: PartyOpeningDraft[]
  container: ContainerOpeningDraft[]
}

export interface OpeningSaveRequest {
  revision: number
  cutoverDate: string
  inventory: Array<{
    warehouse: LedgerReferenceInput
    product: LedgerReferenceInput
    quantity: string
    unitPrice: string
    currency: string
  }>
  fund: Array<{
    fundAccount: LedgerReferenceInput
    balanceType: 'POSITIVE' | 'OVERDRAFT'
    amount: string
  }>
  party: Array<{
    counterpartyType: 'customer' | 'supplier'
    counterparty: LedgerReferenceInput
    currency: string
    balanceType: 'RECEIVABLE' | 'PAYABLE'
    amount: string
  }>
  container: Array<{
    customer: LedgerReferenceInput
    containerType: 'SOLVENT' | 'RESIN'
    quantity: number
  }>
}

export interface OpeningMutationResult {
  status: OpeningStatus
  revision: number
  generationId?: string
}

export interface OpeningAuditEvent {
  id: string
  eventType: string
  fromStatus?: string
  toStatus: string
  generationId?: string
  revision: number
  actorId: string
  occurredAt: string
  reason?: string
  requestId: string
  summary: unknown
}
