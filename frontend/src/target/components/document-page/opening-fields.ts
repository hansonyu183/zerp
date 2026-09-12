import { ulid } from 'ulid'
import type { OpeningDraft } from './opening-data.ts'
export function createOpeningAsset(
  existing = false,
): OpeningDraft['assets'][number] {
  return existing
    ? {
        assetId: '',
        currency: 'CNY',
        originalValue: '0.00',
        accumulatedDepreciation: '0.00',
      }
    : {
        assetId: ulid(),
        assetNo: '',
        name: '',
        categoryId: '',
        departmentId: '',
        usefulLifeMonths: 12,
        residualRate: '0.00',
        acquiredOn: '',
        currency: 'CNY',
        originalValue: '0.00',
        accumulatedDepreciation: '0.00',
      }
}
export function createOpeningBill(
  existing = false,
): OpeningDraft['bills'][number] {
  return existing
    ? { billId: '', currency: 'CNY', valueAmount: '0.00' }
    : {
        billId: ulid(),
        billNo: '',
        billType: '',
        positionType: 'ASSET',
        medium: 'ELECTRONIC',
        currency: 'CNY',
        faceAmount: '0.00',
        issueDate: '',
        maturityDate: '',
        drawer: '',
        acceptor: '',
        payee: '',
        annualRateBps: 0,
        interestDays: 0,
        interestAmount: '0.00',
        customerCostAmount: '0.00',
        valueAmount: '0.00',
      }
}
export function createOpeningContainer(): OpeningDraft['containers'][number] {
  return {
    subunit: {
      entity: 'customer-subunit',
      objectId: '',
      customerId: '',
      approvalEntryId: '',
      code: '',
      name: '',
    },
    containerType: 'SOLVENT',
    quantity: 1,
  }
}
export function createOpeningLine(
  baseCurrency: string,
): OpeningDraft['lines'][number] {
  return {
    subjectId: '',
    currency: baseCurrency,
    direction: 'DEBIT',
    amount: '0.00',
    dimensions: {},
  }
}
