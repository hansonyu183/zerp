import type { BillCashLineDraft, BillLineDraft, BillVoucherForm } from './vm'

function reference(value: { objectId: string; versionId: string } | null) {
  return value
    ? { objectId: value.objectId, versionId: value.versionId }
    : undefined
}

export function buildBillReceiptPayload(form: BillVoucherForm) {
  return {
    businessDate: form.businessDate,
    currency: form.currency,
    remark: form.remark || undefined,
    counterparty: reference(form.customer),
    handler: reference(form.handler),
    internalCostRateBps: form.internalCostRateBps,
    billLines: form.billLines.map((line: BillLineDraft) =>
      line.purpose === 'CHANGE'
        ? {
            billId: line.billId!,
            purpose: 'CHANGE' as const,
            remark: line.remark || undefined,
          }
        : {
            positionType: 'ASSET' as const,
            direction: 'IN' as const,
            purpose: 'PRIMARY' as const,
            billType: line.billType,
            billNo: line.billNo,
            medium: line.medium,
            currency: line.currency,
            faceAmount: line.faceAmount,
            issueDate: line.issueDate,
            maturityDate: line.maturityDate,
            drawer: line.drawer,
            acceptor: line.acceptor,
            payee: line.payee,
            annualRateBps: line.annualRateBps,
            remark: line.remark || undefined,
          },
    ),
    billCashLines: form.billCashLines.map((line: BillCashLineDraft) => ({
      ...(line.billLineId ? { billLineId: line.billLineId } : {}),
      fundAccount: reference(line.fundAccount)!,
      direction: line.direction,
      amountType: line.amountType,
      amount: line.amount,
      remark: line.remark || undefined,
    })),
  }
}

export function buildBillPaymentPayload(form: BillVoucherForm) {
  return {
    businessDate: form.businessDate,
    currency: form.currency,
    remark: form.remark || undefined,
    supplier: reference(form.supplier),
    handler: reference(form.handler),
    billLines: form.billLines.map((line: BillLineDraft) => ({
      billId: line.billId!,
      purpose: 'PRIMARY' as const,
      remark: line.remark || undefined,
    })),
  }
}

export function buildBillIssuePayload(form: BillVoucherForm) {
  return {
    businessDate: form.businessDate,
    currency: form.currency,
    remark: form.remark || undefined,
    supplier: reference(form.supplier),
    interestMode: form.interestMode,
    ...(form.interestMode === 'THIRD_PARTY_PAYABLE'
      ? { interestParty: reference(form.interestParty) }
      : {}),
    billLines: form.billLines.map((line: BillLineDraft) => ({
      positionType: 'LIABILITY' as const,
      direction: 'IN' as const,
      purpose: 'PRIMARY' as const,
      billType: line.billType,
      billNo: line.billNo,
      medium: line.medium,
      currency: line.currency,
      faceAmount: line.faceAmount,
      issueDate: line.issueDate,
      maturityDate: line.maturityDate,
      drawer: line.drawer,
      acceptor: line.acceptor,
      payee: line.payee,
      annualRateBps: line.annualRateBps,
      remark: line.remark || undefined,
    })),
    billCashLines: form.billCashLines.map((line: BillCashLineDraft) => ({
      fundAccount: reference(line.fundAccount)!,
      direction: line.direction,
      amountType: line.amountType,
      amount: line.amount,
      remark: line.remark || undefined,
    })),
  }
}

export function buildBillDiscountPayload(form: BillVoucherForm) {
  return {
    businessDate: form.businessDate,
    currency: form.currency,
    remark: form.remark || undefined,
    counterparty: reference(form.counterparty),
    counterpartyType: 'other-party' as const,
    interestMode: form.interestMode,
    ...(form.interestMode === 'THIRD_PARTY_PAYABLE'
      ? { interestParty: reference(form.interestParty) }
      : {}),
    withRecourse: form.withRecourse,
    billLines: form.billLines.map((line: BillLineDraft) => ({
      billId: line.billId!,
      purpose: 'PRIMARY' as const,
      annualRateBps: line.annualRateBps,
      remark: line.remark || undefined,
    })),
    billCashLines: form.billCashLines.map((line: BillCashLineDraft) => ({
      fundAccount: reference(line.fundAccount)!,
      direction: line.direction,
      amountType: line.amountType,
      amount: line.amount,
      remark: line.remark || undefined,
    })),
  }
}
