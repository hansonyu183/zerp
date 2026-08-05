import { describe, expect, it } from 'vitest'
import {
  buildBillPaymentPayload,
  buildBillReceiptPayload,
} from '@/pages/vou/shared/bill/payload'
import { appendHeldBillLines } from '@/pages/vou/shared/bill/selection'
import {
  previewInterestAmount,
  summarizeBillVoucher,
  validateBillVoucherForm,
} from '@/pages/vou/shared/bill/validation'
import type { BillVoucherForm } from '@/pages/vou/shared/bill/vm'

function form(): BillVoucherForm {
  return {
    businessDate: '2026-08-05',
    currency: 'CNY',
    remark: '',
    customer: { objectId: 'c', versionId: 'cv', code: 'C', name: '客户' },
    supplier: null,
    handler: { objectId: 'e', versionId: 'ev', code: 'E', name: '经办人' },
    internalCostRateBps: 0,
    billLines: [
      {
        key: '1',
        positionType: 'ASSET',
        direction: 'IN',
        purpose: 'PRIMARY',
        billType: 'BANK_ACCEPTANCE',
        billNo: 'B1',
        medium: 'ELECTRONIC',
        currency: 'CNY',
        faceAmount: '100.00',
        issueDate: '2026-08-01',
        maturityDate: '2026-09-01',
        drawer: 'D',
        acceptor: 'A',
        payee: 'P',
        annualRateBps: 100,
        interestDays: 1,
        interestAmount: '1.00',
        customerCostAmount: '1.00',
        remark: '',
      },
    ],
    billCashLines: [],
  }
}

describe('bill receipt payload', () => {
  it('enforces the 20-line limit and keeps computed values out of input', () => {
    const value = form()
    value.billLines = Array.from({ length: 21 }, (_, i) => ({
      ...value.billLines[0]!,
      key: String(i),
    }))
    expect(validateBillVoucherForm(value)).toContain('1-20')
    const payload = buildBillReceiptPayload(form())
    expect(payload.billLines[0]).not.toHaveProperty('interestDays')
    expect(payload.billLines[0]).not.toHaveProperty('customerCostAmount')
    expect(payload.counterparty).toEqual({ objectId: 'c', versionId: 'cv' })
  })

  it('previews integer interest with half-up rounding', () => {
    expect(previewInterestAmount('100.00', 365, 1)).toBe('0.01')
    expect(previewInterestAmount('0.01', 1, 1)).toBe('0.00')
  })

  it('appends distinct held bills without exceeding 20 lines', () => {
    const value = form()
    const held = [
      { ...value.billLines[0]!, key: 'held-1', billId: 'bill-1' },
      { ...value.billLines[0]!, key: 'held-2', billId: 'bill-2' },
    ]
    const result = appendHeldBillLines(
      value.billLines,
      held,
      ['bill-1', 'bill-2'],
      2,
    )
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      billId: 'bill-1',
      purpose: 'CHANGE',
      direction: 'OUT',
    })
  })

  it('summarizes票据、找零和现金净额 without floating point math', () => {
    const value = form()
    value.billLines.push({
      ...value.billLines[0]!,
      key: 'change',
      billId: 'held-bill',
      purpose: 'CHANGE',
      direction: 'OUT',
      faceAmount: '40.00',
    })
    value.billCashLines = [
      {
        key: 'cash-in',
        fundAccount: {
          objectId: 'f',
          versionId: 'fv',
          code: 'F',
          name: '银行',
        },
        direction: 'IN',
        amountType: 'PRINCIPAL',
        amount: '0.01',
        remark: '',
      },
    ]
    expect(summarizeBillVoucher(value)).toEqual({
      primary: '100.00',
      change: '40.00',
      cashIn: '0.01',
      cashOut: '0.00',
      net: '60.01',
      valid: true,
    })
  })
})

describe('bill payment payload', () => {
  it('requires supplier and submits only held bill ids as PRIMARY', () => {
    const value = form()
    value.customer = null
    value.supplier = { objectId: 's', versionId: 'sv', code: 'S', name: '供应商' }
    value.billLines = [{ ...value.billLines[0]!, billId: 'held-1', purpose: 'PRIMARY' }]
    const payload = buildBillPaymentPayload(value)
    expect(payload.supplier).toEqual({ objectId: 's', versionId: 'sv' })
    expect(payload.billLines).toEqual([{ billId: 'held-1', purpose: 'PRIMARY' }])
    expect(validateBillVoucherForm(value, 20, 0, 'payment')).toBeNull()
  })
})
