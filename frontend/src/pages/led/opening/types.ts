import type { LedgerReference } from '@/pages/led/shared'

export interface InventoryOpeningView {
  id: string
  warehouse: LedgerReference
  product: LedgerReference
  quantity: string
  currency: string
  costAmount: string
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

export interface ClosingView {
  revision: number
  latestClosingDate?: string
  openingDate?: string
  inventory: InventoryOpeningView[]
  fund: FundOpeningView[]
  party: PartyOpeningView[]
  container: ContainerOpeningView[]
}

export interface ClosingMutationResult {
  revision: number
  latestClosingDate?: string
  openingDate?: string
}

export interface ClosingHistoryItem {
  id: string
  closingDate: string
  openingDate: string
  status: 'ACTIVE' | 'REVERSED'
  revision: number
  closedAt: string
  closedBy: string
  requestId: string
  reversedAt?: string
  reversedBy?: string
  reverseReason?: string
  reverseRequestId?: string
}
