import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type {
  IntermediaryCalculationSource,
  IntermediaryResultLine,
} from '@/components/voucher'
import {
  runIntermediaryScript,
  validateIntermediaryResult,
} from '@/pages/vou/intermediary-calculation/sandbox'

const customer = {
  objectId: 'customer-1',
  versionId: 'customer-v1',
  entity: 'customer' as const,
  code: 'CUS-001',
  name: '客户一',
}
const salesperson = {
  objectId: 'employee-1',
  versionId: 'employee-v1',
  entity: 'employee' as const,
  code: 'EMP-001',
  name: '业务员一',
}
const source: IntermediaryCalculationSource = {
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  currency: 'CNY',
  lines: [
    {
      sourceSignoffLineId: 'signoff-line-1',
      sourceKind: 'SALE',
      signoffDocumentId: 'signoff-1',
      signoffDocumentNo: 'SOF-001',
      signoffDate: '2026-07-01',
      orderDocumentId: 'order-1',
      orderDocumentNo: 'SOR-001',
      orderDate: '2026-06-20',
      dueDate: '2026-07-10',
      collectionDate: '2026-07-15',
      collectionDelayDays: 5,
      customer,
      salesperson,
      product: {
        objectId: 'product-1',
        versionId: 'product-v1',
        entity: 'product',
        code: 'P-001',
        name: '产品一',
      },
      productKind: 'STANDARD_FINISHED',
      signedQuantity: '2',
      pricingQuantity: '400',
      barrelQuantity: '2',
      unitPrice: '5.00',
      referenceUnitPrice: '4.00',
      settlementSurcharge: '0.10',
      rebateUnitPrice: '0.20',
      lineAmount: '2000.00',
      settlementTermCode: 'MONTHLY_30',
      specialApproval: false,
      adjustmentEmployeeAmount: '0.00',
      adjustmentIntermediaryAmount: '0.00',
      adjustmentRebateAmount: '0.00',
    },
  ],
  bills: [],
}

const resultLine: IntermediaryResultLine = {
  sourceSignoffLineId: 'signoff-line-1',
  premiumUnitPrice: '0.70',
  barrelQuantity: '2',
  baseCommission: '16.00',
  premiumCommission: '70.00',
  lowPriceCommission: '0.00',
  marketMaintenanceSubsidy: '4.00',
  marketDevelopmentSubsidy: '1800.00',
  billCost: '0.00',
  billLineIds: [],
  employeeAmount: '1890.00',
  intermediaryAmount: '0.00',
  rebateAmount: '80.00',
}

const migration = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../backend/db/migrations/00057_intermediary_calculation.sql',
  ),
  'utf8',
)
const seededScript = migration.match(/\$script\$\n([\s\S]*?)\n\$script\$/u)?.[1]
if (!seededScript) throw new Error('默认居间计算脚本不存在')

function result() {
  return {
    lines: [{ ...resultLine }],
    summaries: [
      { payee: salesperson, category: 'COMMISSION', amount: '1890.00' },
      { payee: customer, category: 'REBATE', amount: '80.00' },
    ],
  }
}

describe('intermediary calculation QuickJS sandbox', () => {
  it('executes the exact seeded business rules', async () => {
    const ordinarySource = structuredClone(source)
    ordinarySource.bills = [
      {
        billLineId: 'bill-line-1',
        receiptDocumentId: 'bill-receipt-1',
        receiptDocumentNo: 'BRE-001',
        receiptDate: '2026-07-01',
        customer,
        salesperson,
        billType: 'BANK_ACCEPTANCE',
        faceAmount: '3650.00',
        issueDate: '2026-07-01',
        maturityDate: '2026-10-09',
        costDays: 100,
      },
    ]
    const ordinary = await runIntermediaryScript(seededScript, ordinarySource)
    expect(ordinary.lines[0]).toMatchObject({
      baseCommission: '16.00',
      premiumCommission: '70.00',
      marketMaintenanceSubsidy: '4.00',
      marketDevelopmentSubsidy: '1800.00',
      billCost: '30.00',
      billLineIds: ['bill-line-1'],
      employeeAmount: '1860.00',
      rebateAmount: '80.00',
    })
    expect(ordinary.summaries).toEqual([
      { payee: salesperson, category: 'COMMISSION', amount: '1860.00' },
      { payee: customer, category: 'REBATE', amount: '80.00' },
    ])

    const specialSource = structuredClone(source)
    specialSource.lines[0].specialApproval = true
    specialSource.lines[0].collectionDelayDays = 8
    const special = await runIntermediaryScript(seededScript, specialSource)
    expect(special.lines[0]).toMatchObject({
      baseCommission: '0.00',
      premiumCommission: '0.00',
      lowPriceCommission: '6.00',
      marketMaintenanceSubsidy: '0.00',
      marketDevelopmentSubsidy: '0.00',
      employeeAmount: '6.00',
    })

    const intermediary = {
      objectId: 'other-unit-1',
      versionId: 'other-unit-v1',
      entity: 'other-unit' as const,
      code: 'OTP-001',
      name: '居间商一',
    }
    const intermediarySource = structuredClone(source)
    intermediarySource.lines[0].intermediary = intermediary
    const intermediated = await runIntermediaryScript(
      seededScript,
      intermediarySource,
    )
    expect(intermediated.lines[0]).toMatchObject({
      premiumCommission: '0.00',
      employeeAmount: '1820.00',
      intermediaryAmount: '247.79',
      rebateAmount: '80.00',
    })
    expect(intermediated.summaries).toContainEqual({
      payee: intermediary,
      category: 'INTERMEDIARY',
      amount: '247.79',
    })
  })

  it('matches the 2026 collection-delay brackets', async () => {
    const cases = [
      ['PREPAID', 7, '16.00', '70.00'],
      ['PREPAID', 8, '0.00', '70.00'],
      ['PREPAID', 16, '0.00', '0.00'],
      ['MONTHLY_CURRENT', 0, '10.00', '70.00'],
      ['MONTHLY_CURRENT', 8, '6.00', '70.00'],
      ['MONTHLY_CURRENT', 21, '0.00', '0.00'],
      ['ARRIVAL_30', 8, '6.00', '70.00'],
      ['ARRIVAL_30', 16, '0.00', '70.00'],
      ['ARRIVAL_30', 21, '0.00', '0.00'],
      ['MONTHLY_30', 8, '10.00', '70.00'],
      ['MONTHLY_30', 11, '6.00', '70.00'],
      ['MONTHLY_30', 21, '0.00', '70.00'],
      ['MONTHLY_30', 31, '0.00', '0.00'],
      ['MONTHLY_60', 1, '10.00', '70.00'],
      ['MONTHLY_60', 8, '6.00', '70.00'],
      ['MONTHLY_60', 21, '6.00', '70.00'],
      ['MONTHLY_60', 31, '0.00', '0.00'],
      ['MONTHLY_90', 0, '0.00', '0.00'],
    ] as const
    for (const [term, delay, baseCommission, premiumCommission] of cases) {
      const caseSource = structuredClone(source)
      caseSource.lines[0].settlementTermCode = term
      caseSource.lines[0].collectionDelayDays = delay
      const calculated = await runIntermediaryScript(seededScript, caseSource)
      expect(
        calculated.lines[0].baseCommission,
        `${term} 延期 ${delay} 天`,
      ).toBe(baseCommission)
      expect(
        calculated.lines[0].premiumCommission,
        `${term} 延期 ${delay} 天`,
      ).toBe(premiumCommission)
    }

    const expiredSpecial = structuredClone(source)
    expiredSpecial.lines[0].specialApproval = true
    expiredSpecial.lines[0].collectionDelayDays = 21
    const calculatedSpecial = await runIntermediaryScript(
      seededScript,
      expiredSpecial,
    )
    expect(calculatedSpecial.lines[0]).toMatchObject({
      lowPriceCommission: '0.00',
      employeeAmount: '0.00',
    })
  })

  it('executes a calculation without exposing host globals', async () => {
    const calculated = await runIntermediaryScript(
      `globalThis.calculate = (input) => ({
        lines: [{
          sourceSignoffLineId: input.lines[0].sourceSignoffLineId,
          premiumUnitPrice: '0.70', barrelQuantity: '2',
          baseCommission: '16.00', premiumCommission: '70.00',
          lowPriceCommission: '0.00', marketMaintenanceSubsidy: '4.00',
          marketDevelopmentSubsidy: '1800.00', billCost: '0.00',
          billLineIds: [],
          employeeAmount: '1890.00', intermediaryAmount: '0.00',
          rebateAmount: '80.00'
        }],
        summaries: [
          { payee: input.lines[0].salesperson, category: 'COMMISSION', amount: '1890.00' },
          { payee: input.lines[0].customer, category: 'REBATE', amount: '80.00' }
        ],
        hostType: typeof document
      });`,
      source,
    )

    expect(calculated).toEqual(result())
  })

  it('rejects missing entrypoints and script exceptions', async () => {
    await expect(
      runIntermediaryScript('const value = 1;', source),
    ).rejects.toThrow('脚本必须定义')
    await expect(
      runIntermediaryScript(
        `globalThis.calculate = () => { throw new Error('broken rule'); };`,
        source,
      ),
    ).rejects.toThrow('broken rule')
  })

  it('validates result shape, formatting, and source-line identity', () => {
    expect(validateIntermediaryResult(result(), source)).toEqual(result())
    expect(() =>
      validateIntermediaryResult({ lines: result().lines }, source),
    ).toThrow('summaries')
    expect(() =>
      validateIntermediaryResult(
        {
          ...result(),
          lines: [{ ...resultLine, employeeAmount: '-1.00' }],
        },
        source,
      ),
    ).toThrow('金额方向')
    expect(() =>
      validateIntermediaryResult(
        {
          ...result(),
          summaries: [
            { payee: salesperson, category: 'UNKNOWN', amount: '1.00' },
          ],
        },
        source,
      ),
    ).toThrow('汇总')
    expect(() =>
      validateIntermediaryResult(
        {
          ...result(),
          summaries: [
            { payee: salesperson, category: 'COMMISSION', amount: '1889.00' },
            { payee: customer, category: 'REBATE', amount: '80.00' },
          ],
        },
        source,
      ),
    ).toThrow('明细金额和收款方')
    expect(() =>
      validateIntermediaryResult(
        {
          ...result(),
          summaries: [
            {
              payee: { ...salesperson, versionId: 'employee-v2' },
              category: 'COMMISSION',
              amount: '1890.00',
            },
            { payee: customer, category: 'REBATE', amount: '80.00' },
          ],
        },
        source,
      ),
    ).toThrow('明细金额和收款方')
    expect(() =>
      validateIntermediaryResult(
        {
          ...result(),
          lines: [{ ...resultLine, sourceSignoffLineId: 'other-line' }],
        },
        source,
      ),
    ).toThrow('一一对应')
    expect(() =>
      validateIntermediaryResult(
        {
          ...result(),
          lines: [{ ...resultLine, barrelQuantity: '3' }],
        },
        source,
      ),
    ).toThrow('桶数')
  })

  it('rejects a bill allocation that does not deduct a positive cost', () => {
    const billSource = structuredClone(source)
    billSource.bills = [
      {
        billLineId: 'bill-line-1',
        receiptDocumentId: 'bill-receipt-1',
        receiptDocumentNo: 'BRE-001',
        receiptDate: '2026-07-01',
        customer,
        salesperson,
        billType: 'BANK_ACCEPTANCE',
        faceAmount: '100.00',
        issueDate: '2026-07-01',
        maturityDate: '2026-08-01',
        costDays: 31,
      },
    ]
    const invalid = result()
    invalid.lines[0].billLineIds = ['bill-line-1']

    expect(() => validateIntermediaryResult(invalid, billSource)).toThrow(
      '正数票据成本',
    )
  })

  it('keeps an unmatched bill available for a later period', async () => {
    const billOnlySource = structuredClone(source)
    billOnlySource.lines = []
    billOnlySource.bills = [
      {
        billLineId: 'bill-line-carry',
        receiptDocumentId: 'bill-receipt-carry',
        receiptDocumentNo: 'BRE-CARRY',
        receiptDate: '2026-07-01',
        customer,
        salesperson,
        billType: 'CHECK',
        faceAmount: '100.00',
        issueDate: '2026-07-01',
        maturityDate: '2026-07-31',
        costDays: 30,
      },
    ]

    await expect(
      runIntermediaryScript(seededScript, billOnlySource),
    ).resolves.toEqual({
      lines: [],
      summaries: [],
    })
  })

  it('does not allocate a bill whose calculated cost rounds to zero', async () => {
    const zeroCostSource = structuredClone(source)
    zeroCostSource.bills = [
      {
        billLineId: 'bill-line-zero-cost',
        receiptDocumentId: 'bill-receipt-zero-cost',
        receiptDocumentNo: 'BRE-ZERO-COST',
        receiptDate: '2026-07-01',
        customer,
        salesperson,
        billType: 'CHECK',
        faceAmount: '1.00',
        issueDate: '2026-07-01',
        maturityDate: '2026-07-02',
        costDays: 1,
      },
    ]

    const calculated = await runIntermediaryScript(seededScript, zeroCostSource)

    expect(calculated.lines[0]).toMatchObject({
      billCost: '0.00',
      billLineIds: [],
      employeeAmount: '1890.00',
    })
  })

  it('carries a matched bill when the current commission cannot absorb its full cost', async () => {
    const insufficientSource = structuredClone(source)
    insufficientSource.bills = [
      {
        billLineId: 'bill-line-too-large',
        receiptDocumentId: 'bill-receipt-too-large',
        receiptDocumentNo: 'BRE-TOO-LARGE',
        receiptDate: '2026-07-01',
        customer,
        salesperson,
        billType: 'BANK_ACCEPTANCE',
        faceAmount: '365000.00',
        issueDate: '2026-07-01',
        maturityDate: '2026-10-09',
        costDays: 100,
      },
    ]

    const calculated = await runIntermediaryScript(
      seededScript,
      insufficientSource,
    )

    expect(calculated.lines[0]).toMatchObject({
      billCost: '0.00',
      billLineIds: [],
      employeeAmount: '1890.00',
    })
    expect(calculated.summaries).toContainEqual({
      payee: salesperson,
      category: 'COMMISSION',
      amount: '1890.00',
    })
  })

  it('reverses the saved original amounts for a cross-month return', async () => {
    const returnSource = structuredClone(source)
    returnSource.lines[0] = {
      ...returnSource.lines[0],
      sourceKind: 'RETURN_ADJUSTMENT',
      signedQuantity: '1',
      pricingQuantity: '200',
      barrelQuantity: '1',
      lineAmount: '1000.00',
      returnDocumentNos: ['SRT-001'],
      adjustmentEmployeeAmount: '10.00',
      adjustmentIntermediaryAmount: '5.00',
      adjustmentRebateAmount: '2.00',
      intermediary: {
        objectId: 'other-unit-1',
        versionId: 'other-unit-v1',
        entity: 'other-unit',
        code: 'OTP-001',
        name: '居间商一',
      },
    }

    const calculated = await runIntermediaryScript(seededScript, returnSource)
    expect(calculated.lines[0]).toMatchObject({
      sourceSignoffLineId: 'signoff-line-1',
      billLineIds: [],
      employeeAmount: '-10.00',
      intermediaryAmount: '-5.00',
      rebateAmount: '-2.00',
      note: '跨月退货冲回：SRT-001',
    })
    expect(calculated.summaries).toEqual([
      { payee: salesperson, category: 'COMMISSION', amount: '-10.00' },
      {
        payee: returnSource.lines[0].intermediary,
        category: 'INTERMEDIARY',
        amount: '-5.00',
      },
      { payee: customer, category: 'REBATE', amount: '-2.00' },
    ])
    const invalid = structuredClone(calculated)
    invalid.lines[0].employeeAmount = '0.00'
    expect(() => validateIntermediaryResult(invalid, returnSource)).toThrow(
      '必须与来源金额一致',
    )
  })
})
