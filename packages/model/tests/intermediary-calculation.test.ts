import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkIntermediaryResult,
  type VouIntermediaryCalculationInput,
} from '../src/index.ts'
type Source = VouIntermediaryCalculationInput['source']
const customer = {
  entity: 'customer-subunit' as const,
  objectId: 'customer',
  approvalEntryId: 'customer-version',
  code: 'CUS',
  name: '客户',
}
const employee = {
  entity: 'employee' as const,
  objectId: 'employee',
  code: 'EMP',
  name: '业务员',
}
const source: Source = {
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  currency: 'CNY',
  bills: [],
  lines: [
    {
      sourceSignoffLineId: 'signoff:line',
      sourceKind: 'SALE',
      signoffDocumentId: 'signoff',
      signoffDocumentNo: 'SSF',
      signoffDate: '2026-09-01',
      orderDocumentId: 'order',
      orderDocumentNo: 'SOR',
      orderDate: '2026-09-01',
      dueDate: '2026-09-01',
      collectionDate: '2026-09-01',
      collectionDelayDays: 0,
      customer,
      salesperson: employee,
      salesAttributionType: 'INTERNAL_EMPLOYEE',
      salesContractStatus: 'NOT_REQUIRED',
      product: {
        entity: 'product',
        objectId: 'product',
        approvalEntryId: 'product-version',
        code: 'PRD',
        name: '产品',
      },
      behaviorProfile: 'RAW_MATERIAL',
      signedBaseQuantity: '1.000000',
      pricingQuantity: '1.000000',
      standardPieceQuantity: '1.000000',
      unitPrice: '20.00',
      referenceUnitPrice: '10.00',
      settlementSurcharge: '0.00',
      customerTypeCode: 'DIRECT',
      paymentSurcharge: '0.00',
      transportSurcharge: '0.00',
      defaultPremiumUnitPrice: '0.00',
      defaultDiscountUnitPrice: '0.00',
      thirdPartyIntermediaryFixedUnitCost: '0.00',
      thirdPartyIntermediaryVariableUnitCost: '0.00',
      costItems: [],
      lineAmount: '20.00',
      settlementTermCode: 'PREPAID',
      specialApproval: false,
      adjustmentEmployeeAmount: '0.00',
      adjustmentIntermediaryAmount: '0.00',
    },
  ],
}
const line = {
  sourceSignoffLineId: 'signoff:line',
  premiumUnitPrice: '0.00',
  standardPieceQuantity: '1.000000',
  baseCommission: '10.00',
  premiumCommission: '0.00',
  lowPriceCommission: '0.00',
  marketMaintenanceSubsidy: '0.00',
  marketDevelopmentSubsidy: '0.00',
  billCost: '0.00',
  billLineIds: [],
  employeeAmount: '10.00',
  intermediaryAmount: '2.00',
}
const result = () => ({
  lines: [structuredClone(line)],
  summaries: [
    { category: 'COMMISSION', payee: employee, amount: '10.00' },
    { category: 'INTERMEDIARY', payee: employee, customer, amount: '2.00' },
  ],
})
test('validates script arithmetic and keeps third-party costs grouped by customer', () => {
  assert.deepEqual(checkIntermediaryResult(source, result()), {
    ok: true,
    amount: '12.00',
  })
  const wrong = result()
  wrong.summaries[1]!.customer = { ...customer, objectId: 'other-customer' }
  assert.deepEqual(checkIntermediaryResult(source, wrong), { ok: false })
  const arithmetic = result()
  arithmetic.lines[0]!.employeeAmount = '9.00'
  assert.deepEqual(checkIntermediaryResult(source, arithmetic), { ok: false })
  assert.deepEqual(
    checkIntermediaryResult(source, { lines: [], summaries: [] }),
    { ok: false },
  )
})
test('requires exact negative reversal of the original confirmed result', () => {
  const adjustment = structuredClone(source)
  adjustment.lines = [
    {
      ...source.lines[0]!,
      sourceKind: 'RETURN_ADJUSTMENT',
      adjustmentEmployeeAmount: '3.33',
      adjustmentIntermediaryAmount: '0.67',
    },
  ]
  const returned = {
    lines: [
      {
        ...line,
        baseCommission: '0.00',
        employeeAmount: '-3.33',
        intermediaryAmount: '-0.67',
      },
    ],
    summaries: [
      { category: 'COMMISSION', payee: employee, amount: '-3.33' },
      { category: 'INTERMEDIARY', payee: employee, customer, amount: '-0.67' },
    ],
  }
  assert.deepEqual(checkIntermediaryResult(adjustment, returned), {
    ok: true,
    amount: '-4.00',
  })
  returned.lines[0]!.employeeAmount = '-3.32'
  assert.deepEqual(checkIntermediaryResult(adjustment, returned), { ok: false })
})
test('bill cost cannot be charged without assigning its source', () => {
  const wrong = result()
  wrong.lines[0]!.billCost = '1.00'
  wrong.lines[0]!.employeeAmount = '9.00'
  wrong.summaries[0]!.amount = '9.00'
  assert.deepEqual(checkIntermediaryResult(source, wrong), { ok: false })
})

test('groups a stable payee across adopted historical names while preserving a real source reference', () => {
  const input = structuredClone(source)
  input.lines = [
    ...input.lines,
    {
      ...input.lines[0]!,
      sourceSignoffLineId: 'second',
      salesperson: { ...employee, name: '改名后' },
    },
  ]
  const output = result()
  output.lines.push({ ...line, sourceSignoffLineId: 'second' })
  output.summaries[0]!.amount = '20.00'
  output.summaries[1]!.amount = '4.00'
  assert.deepEqual(checkIntermediaryResult(input, output), {
    ok: true,
    amount: '24.00',
  })
  output.summaries[0]!.payee = { ...employee, name: '改名后' }
  assert.deepEqual(checkIntermediaryResult(input, output), {
    ok: true,
    amount: '24.00',
  })
  output.summaries[0]!.payee = { ...employee, name: '来源中不存在' }
  assert.deepEqual(checkIntermediaryResult(input, output), { ok: false })
})
