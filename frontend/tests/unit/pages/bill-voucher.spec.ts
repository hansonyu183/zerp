import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { apiClient } from '@/api/client'
import {
  buildBillPaymentPayload,
  buildBillIssuePayload,
  buildBillDiscountPayload,
  buildBillMaturityPayload,
  buildBillReceiptPayload,
} from '@/pages/vou/shared/bill/payload'
import { appendHeldBillLines } from '@/pages/vou/shared/bill/selection'
import {
  previewInterestAmount,
  summarizeBillVoucher,
  validateBillVoucherForm,
} from '@/pages/vou/shared/bill/validation'
import type { BillVoucherForm } from '@/pages/vou/shared/bill/vm'
import { billVoucherConfigs } from '@/pages/vou/shared/bill/config'
import { useBillVoucherViewModel } from '@/pages/vou/shared/bill/vm'
import { useSessionStore } from '@/stores/session'
import { useBillLedgerViewModel } from '@/pages/led/bill/vm'
import BillReceipt from '@/pages/vou/bill-receipt/BillReceipt.vue'
import BillPayment from '@/pages/vou/bill-payment/BillPayment.vue'
import BillIssue from '@/pages/vou/bill-issue/BillIssue.vue'
import BillDiscount from '@/pages/vou/bill-discount/BillDiscount.vue'
import BillMaturity from '@/pages/vou/bill-maturity/BillMaturity.vue'
import BillLedgerPage from '@/pages/led/bill/Bill.vue'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    postContract: vi.fn(),
    setCsrfToken: vi.fn(),
    uploadAttachment: vi.fn(),
    fetchAttachment: vi.fn(),
  },
}))

const mockedPost = vi.mocked(apiClient.post)
const mockedPostContract = vi.mocked(apiClient.postContract)

beforeEach(() => {
  setActivePinia(createPinia())
  mockedPost.mockReset()
  mockedPostContract.mockReset()
  mockedPost.mockImplementation(async (path: string) => {
    if (path.startsWith('bob/'))
      return {
        data: {
          items: [
            {
              objectId: 'r',
              entity: 'customer',
              code: 'R',
              currentVersion: { versionId: 'rv', summary: { name: '引用' } },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      } as never
    if (path.includes('/query'))
      return { data: { items: [], total: 0 } } as never
    if (path.includes('/create'))
      return {
        data: {
          documentId: 'DOC-1',
          documentNo: 'V-1',
          revision: 1,
          status: 'DRAFT',
        },
      } as never
    if (path.includes('/save'))
      return {
        data: {
          documentId: 'DOC-1',
          documentNo: 'V-1',
          revision: 2,
          status: 'DRAFT',
        },
      } as never
    if (path.includes('/get'))
      return {
        data: {
          documentId: 'DOC-1',
          documentNo: 'V-1',
          revision: 1,
          status: 'DRAFT',
          entity: 'bill-maturity',
          amount: '10.00',
          data: {
            businessDate: '2026-08-05',
            currency: 'CNY',
            billLines: [
              {
                lineId: 'L1',
                billId: 'B1',
                purpose: 'PRIMARY',
                positionType: 'ASSET',
                direction: 'IN',
                billType: 'BANK_ACCEPTANCE',
                billNo: 'B1',
                medium: 'ELECTRONIC',
                currency: 'CNY',
                faceAmount: '10.00',
                issueDate: '2026-01-01',
                maturityDate: '2026-09-01',
                drawer: 'D',
                acceptor: 'A',
                payee: 'P',
                annualRateBps: 100,
              },
            ],
            billCashLines: [
              {
                lineId: 'C1',
                fundAccount: {
                  objectId: 'f',
                  versionId: 'fv',
                  code: 'F',
                  name: '账户',
                },
                direction: 'IN',
                amountType: 'INTEREST',
                amount: '1.00',
              },
            ],
          },
        },
      } as never
    return {
      data: {
        documentId: 'DOC-1',
        documentNo: 'V-1',
        revision: 2,
        status: 'CHECKED',
      },
    } as never
  })
  mockedPostContract.mockResolvedValue({
    data: {
      items: [
        {
          billId: 'bill-1',
          positionType: 'ASSET',
          billType: 'BANK_ACCEPTANCE',
          billNo: 'B-1',
          medium: 'ELECTRONIC',
          currency: 'CNY',
          faceAmount: '10.00',
          issueDate: '2026-01-01',
          maturityDate: '2026-09-01',
          drawer: 'D',
          acceptor: 'A',
          payee: 'P',
          originatingParty: {
            objectId: 'customer-1',
            versionId: 'customer-v1',
            entity: 'customer',
            code: 'CUS-001',
            name: '客户一',
          },
          annualRateBps: 100,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  } as never)
})

function form(): BillVoucherForm {
  return {
    businessDate: '2026-08-05',
    currency: 'CNY',
    remark: '',
    customer: { objectId: 'c', versionId: 'cv', code: 'C', name: '客户' },
    supplier: null,
    counterparty: { objectId: 'o', versionId: 'ov', code: 'O', name: '贴现方' },
    interestMode: '',
    maturityType: '',
    interestParty: null,
    handler: { objectId: 'e', versionId: 'ev', code: 'E', name: '经办人' },
    internalCostRateBps: 0,
    withRecourse: false,
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

  it('keeps selected held bills that are outside the latest search page', () => {
    const scope = effectScope()
    const vm = scope.run(() =>
      useBillVoucherViewModel(billVoucherConfigs['bill-payment']),
    )!
    vm.openCreate()
    vm.form.billLines = [{
      ...form().billLines[0]!,
      key: 'off-page',
      billId: 'off-page',
      billNo: 'OFF-PAGE',
      faceAmount: '10.00',
      purpose: 'CHANGE',
      direction: 'IN',
    }]
    vm.heldBillOptions.value = [{
      ...form().billLines[0]!,
      key: 'on-page',
      billId: 'on-page',
      billNo: 'ON-PAGE',
      faceAmount: '20.00',
      purpose: 'CHANGE',
      direction: 'IN',
    }]
    vm.heldSelection.value = ['off-page', 'on-page']

    vm.applyHeldSelection()

    expect(vm.form.billLines).toMatchObject([
      { billId: 'off-page', billNo: 'OFF-PAGE', purpose: 'PRIMARY', direction: 'OUT' },
      { billId: 'on-page', billNo: 'ON-PAGE', purpose: 'PRIMARY', direction: 'OUT' },
    ])
    scope.stop()
  })

  it('clears selected bills when the maturity direction changes', () => {
    const scope = effectScope()
    const vm = scope.run(() =>
      useBillVoucherViewModel(billVoucherConfigs['bill-maturity']),
    )!
    vm.openCreate()
    vm.changeMaturityType('RECEIPT')
    vm.form.billLines = [{
      ...form().billLines[0]!,
      key: 'asset-bill',
      billId: 'asset-bill',
      positionType: 'ASSET',
    }]
    vm.heldSelection.value = ['asset-bill']

    vm.changeMaturityType('PAYMENT')

    expect(vm.form.billLines).toEqual([])
    expect(vm.heldSelection.value).toEqual([])
    scope.stop()
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
    value.supplier = {
      objectId: 's',
      versionId: 'sv',
      code: 'S',
      name: '供应商',
    }
    value.billLines = [
      { ...value.billLines[0]!, billId: 'held-1', purpose: 'PRIMARY' },
    ]
    const payload = buildBillPaymentPayload(value)
    expect(payload.supplier).toEqual({ objectId: 's', versionId: 'sv' })
    expect(payload.billLines).toEqual([
      { billId: 'held-1', purpose: 'PRIMARY' },
    ])
    expect(validateBillVoucherForm(value, 20, 0, 'payment')).toBeNull()
  })
})

describe('bill issue payload', () => {
  it('submits complete LIABILITY/IN/PRIMARY lines and real cash lines', () => {
    const value = form()
    value.customer = null
    value.supplier = {
      objectId: 's',
      versionId: 'sv',
      code: 'S',
      name: '供应商',
    }
    value.interestMode = 'THIRD_PARTY_PAYABLE'
    value.interestParty = {
      objectId: 'o',
      versionId: 'ov',
      code: 'O',
      name: '其他单位',
      entity: 'other-party',
    }
    value.billLines = [{ ...value.billLines[0]!, billId: undefined }]
    value.billCashLines = [
      {
        key: 'cash',
        fundAccount: {
          objectId: 'f',
          versionId: 'fv',
          code: 'F',
          name: '账户',
        },
        direction: 'OUT',
        amountType: 'INTEREST',
        amount: '1.00',
        remark: '',
      },
    ]
    const payload = buildBillIssuePayload(value)
    expect(payload.billLines[0]).toMatchObject({
      positionType: 'LIABILITY',
      direction: 'IN',
      purpose: 'PRIMARY',
    })
    expect(payload.billLines[0]).not.toHaveProperty('billId')
    expect(payload.interestParty).toEqual({ objectId: 'o', versionId: 'ov' })
    expect(payload.billCashLines).toHaveLength(1)
    expect(validateBillVoucherForm(value, 20, 20, 'issue')).toBeNull()
  })
})

describe('bill discount payload', () => {
  it('submits selected bill ids, rate, recourse and real cash fees only', () => {
    const value = form()
    value.customer = null
    value.supplier = null
    value.counterparty = {
      objectId: 'o',
      versionId: 'ov',
      code: 'O',
      name: '贴现方',
    }
    value.interestMode = 'THIRD_PARTY_PAYABLE'
    value.interestParty = {
      objectId: 'p',
      versionId: 'pv',
      code: 'P',
      name: '利息方',
      entity: 'other-party',
    }
    value.withRecourse = true
    value.billLines = [{ ...value.billLines[0]!, billId: 'held-1' }]
    value.billCashLines = [
      {
        key: 'cash',
        fundAccount: {
          objectId: 'f',
          versionId: 'fv',
          code: 'F',
          name: '账户',
        },
        direction: 'OUT',
        amountType: 'FEE',
        amount: '1.00',
        remark: '',
      },
    ]
    const payload = buildBillDiscountPayload(value)
    expect(payload).toMatchObject({
      counterparty: { objectId: 'o', versionId: 'ov' },
      withRecourse: true,
    })
    expect(payload.billLines[0]).toEqual({
      billId: 'held-1',
      purpose: 'PRIMARY',
      annualRateBps: 100,
    })
    expect(payload.billLines[0]).not.toHaveProperty('faceAmount')
    expect(payload.billCashLines[0]).toMatchObject({
      direction: 'OUT',
      amountType: 'FEE',
    })
    expect(validateBillVoucherForm(value, 20, 20, 'discount')).toBeNull()
  })
})

describe('bill maturity payload', () => {
  it('submits receipt maturity with selected bills and IN cash rows', () => {
    const value = form()
    value.customer = null
    value.billLines = [
      {
        ...value.billLines[0]!,
        billId: 'held-1',
        positionType: 'ASSET',
        direction: 'OUT',
      },
    ]
    value.maturityType = 'RECEIPT'
    value.billCashLines = [
      {
        key: 'cash',
        fundAccount: {
          objectId: 'f',
          versionId: 'fv',
          code: 'F',
          name: '账户',
        },
        direction: 'IN',
        amountType: 'INTEREST',
        amount: '1.00',
        remark: '',
      },
    ]
    const payload = buildBillMaturityPayload(value)
    expect(payload).toMatchObject({ maturityType: 'RECEIPT' })
    expect(payload.billLines[0]).toEqual({
      billId: 'held-1',
      purpose: 'PRIMARY',
    })
    expect(validateBillVoucherForm(value, 20, 20, 'maturity')).toBeNull()
  })
})

describe('bill voucher view model behavior', () => {
  it('covers create, references, LED selection, save, lifecycle and delete flows', async () => {
    const session = useSessionStore()
    session.$patch({
      permissions: [
        '/vou/bill-maturity/query',
        '/vou/bill-maturity/create',
        '/vou/bill-maturity/get',
        '/vou/bill-maturity/save',
        '/vou/bill-maturity/check',
        '/vou/bill-maturity/delete',
      ],
    })
    const scope = effectScope()
    const vm = scope.run(() =>
      useBillVoucherViewModel(billVoucherConfigs['bill-maturity']),
    )!
    await vm.query()
    expect(vm.rows.value).toEqual([])
    vm.openCreate()
    expect(vm.editing.value).toBe(true)
    vm.form.maturityType = 'RECEIPT'
    vm.changeMaturityType('RECEIPT')
    vm.addBillLine()
    vm.addCashLine()
    await vm.searchCustomer('客户')
    await vm.searchSupplier('供应商')
    await vm.searchOtherParty('其他')
    await vm.searchHandler('经办人')
    await vm.searchFundAccount('账户')
    expect(vm.customerOptions.value[0]).toMatchObject({
      objectId: 'r',
      versionId: 'rv',
      code: 'R',
      name: '引用',
    })
    await vm.openHeldDialog()
    expect(mockedPostContract).toHaveBeenLastCalledWith(
      'led/bill/query',
      expect.objectContaining({
        filters: expect.objectContaining({ availability: 'HELD' }),
      }),
      expect.anything(),
    )
    expect(vm.heldBillOptions.value[0]?.originatingParty).toEqual({
      objectId: 'customer-1',
      versionId: 'customer-v1',
      entity: 'customer',
      code: 'CUS-001',
      name: '客户一',
    })
    vm.heldSelection.value = ['bill-1']
    vm.applyHeldSelection()
    vm.form.billLines = [
      {
        ...vm.form.billLines[0]!,
        key: 'bill-1',
        billId: 'bill-1',
        positionType: 'ASSET',
        direction: 'OUT',
        purpose: 'PRIMARY',
      },
    ]
    vm.form.billCashLines = [
      {
        key: 'cash',
        fundAccount: {
          objectId: 'f',
          versionId: 'fv',
          code: 'F',
          name: '账户',
        },
        direction: 'IN',
        amountType: 'INTEREST',
        amount: '1.00',
        remark: '',
      },
    ]
    expect(await vm.save()).toBe(true)
    await vm.lifecycle('check')
    expect(vm.documentStatus.value).toBe('CHECKED')
    await vm.lifecycle('uncheck', '测试')
    await vm.lifecycle('approve')
    await vm.lifecycle('unapprove', '测试')
    await vm.changePage(0)
    await vm.openDocument({ documentId: 'DOC-1' }, true)
    await vm.loadAudit()
    await vm.uploadAttachments([])
    await vm.downloadAttachment('missing')
    await vm.removeAttachment('missing')
    expect(await vm.deleteDraft('测试删除')).toBe(true)
    scope.stop()
    const issueScope = effectScope()
    const issueVm = issueScope.run(() =>
      useBillVoucherViewModel(billVoucherConfigs['bill-issue']),
    )!
    issueVm.openCreate()
    await issueVm.openDocument({ documentId: 'DOC-1' })
    issueScope.stop()
    const paymentScope = effectScope()
    const paymentVm = paymentScope.run(() =>
      useBillVoucherViewModel(billVoucherConfigs['bill-payment']),
    )!
    paymentVm.openCreate()
    paymentVm.heldBillOptions.value = [
      { ...form().billLines[0]!, billId: 'bill-1' },
    ]
    paymentVm.heldSelection.value = ['bill-1']
    paymentVm.applyHeldSelection()
    expect(paymentVm.form.billLines[0]?.direction).toBe('OUT')
    paymentScope.stop()
  })

  it('rejects invalid maturity form before API mutation', async () => {
    const session = useSessionStore()
    session.$patch({ permissions: ['/vou/bill-maturity/create'] })
    const scope = effectScope()
    const vm = scope.run(() =>
      useBillVoucherViewModel(billVoucherConfigs['bill-maturity']),
    )!
    vm.openCreate()
    expect(await vm.save()).toBe(false)
    expect(vm.errorMessage.value).toContain('到期处理')
    scope.stop()
  })

  it('does not write reference options after its scope is disposed', async () => {
    mockedPost.mockImplementation(
      (_path: string, _body: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener('abort', () => {
            resolve({
              data: {
                items: [
                  {
                    objectId: 'late',
                    entity: 'supplier',
                    code: 'LATE',
                    currentVersion: {
                      versionId: 'late-version',
                      summary: { name: '晚到结果' },
                    },
                  },
                ],
              },
            } as never)
          })
        }) as never,
    )
    const scope = effectScope()
    const vm = scope.run(() =>
      useBillVoucherViewModel(billVoucherConfigs['bill-payment']),
    )!
    const pending = vm.searchSupplier('供应商')
    scope.stop()
    await pending
    expect(vm.supplierOptions.value).toEqual([])
  })

  it('ignores an aborted held-bill search after a newer request starts', async () => {
    let resolveLatest!: (value: unknown) => void
    mockedPostContract
      .mockImplementationOnce(
        (_path, _body, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(new Error('stale request aborted'))
            })
          }) as never,
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveLatest = resolve }) as never,
      )
    const scope = effectScope()
    const vm = scope.run(() =>
      useBillVoucherViewModel(billVoucherConfigs['bill-payment']),
    )!

    const stale = vm.searchHeldBills('旧票据')
    const latest = vm.searchHeldBills('新票据')
    await stale

    expect(vm.errorMessage.value).toBeNull()
    resolveLatest({ data: { items: [], total: 0, page: 1, pageSize: 20 } })
    await latest
    expect(vm.errorMessage.value).toBeNull()
    scope.stop()
  })
})

describe('bill ledger view model behavior', () => {
  it('loads ledger, searches every originating-party type and applies maturity shortcuts', async () => {
    const session = useSessionStore()
    session.$patch({ permissions: ['/led/bill/query'] })
    const scope = effectScope()
    const vm = scope.run(() => useBillLedgerViewModel())!
    await vm.load()
    vm.search()
    await vm.searchOriginatingParty('往来方')
    expect(vm.originatingPartyOptions.value).toHaveLength(3)
    expect(vm.originatingPartyOptions.value[0]).toMatchObject({
      objectId: 'r',
      versionId: 'rv',
      code: 'R',
      name: '引用',
      entity: 'customer',
    })
    expect(vm.originatingPartyOptions.value.map((item) => item.entity)).toEqual(
      ['customer', 'supplier', 'other-party'],
    )
    vm.selectOriginatingParty(vm.originatingPartyOptions.value[1]!)
    vm.originatingPartyOptions.value = []
    expect(vm.selectedOriginatingParty.value).toMatchObject({
      objectId: 'r',
      name: '引用',
      entity: 'supplier',
    })
    expect(vm.filters.originatingPartyType).toBe('supplier')
    expect(vm.filters.originatingPartyObjectId).toBe('r')
    vm.maturityShortcut('30d')
    expect(vm.filters.availability).toBeUndefined()
    vm.maturityShortcut('7d')
    vm.maturityShortcut('today')
    vm.maturityShortcut('overdue')
    vm.changePage(1)
    expect(vm.filters.availability).toBe('MATURED')
    expect(vm.filters.maturityDateTo).toBeTruthy()
    scope.stop()
  })

  it('clears the maturity status filter when leaving the overdue shortcut', () => {
    const session = useSessionStore()
    session.$patch({ permissions: ['/led/bill/query'] })
    const scope = effectScope()
    const vm = scope.run(() => useBillLedgerViewModel())!

    vm.maturityShortcut('overdue')
    expect(vm.filters.availability).toBe('MATURED')
    vm.maturityShortcut('today')
    expect(vm.filters.availability).toBeUndefined()
    scope.stop()
  })

  it('builds maturity shortcuts from the local calendar date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 8, 0, 30))
    const session = useSessionStore()
    session.$patch({ permissions: ['/led/bill/query'] })
    const scope = effectScope()
    const vm = scope.run(() => useBillLedgerViewModel())!

    vm.maturityShortcut('today')
    expect(vm.filters.maturityDateFrom).toBe('2026-08-08')
    expect(vm.filters.maturityDateTo).toBe('2026-08-08')
    vm.maturityShortcut('overdue')
    expect(vm.filters.maturityDateFrom).toBeUndefined()
    expect(vm.filters.maturityDateTo).toBe('2026-08-07')

    scope.stop()
    vi.useRealTimers()
  })

  it('keeps the latest bill ledger load while an older request settles late', async () => {
    const session = useSessionStore()
    session.$patch({ permissions: ['/led/bill/query'] })
    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    mockedPostContract
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve }) as never,
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve }) as never,
      )
    const scope = effectScope()
    const vm = scope.run(() => useBillLedgerViewModel())!

    const first = vm.load()
    const second = vm.load()
    resolveSecond({ data: { items: [{ billId: 'new' }], total: 1 } })
    await second
    resolveFirst({ data: { items: [{ billId: 'old' }], total: 1 } })
    await first

    expect(vm.rows.value).toEqual([{ billId: 'new' }])
    expect(vm.loading.value).toBe(false)
    scope.stop()
  })
})

describe('bill voucher route wrappers', () => {
  it('binds every entity wrapper to the shared bill page', () => {
    for (const component of [
      BillReceipt,
      BillPayment,
      BillIssue,
      BillDiscount,
      BillMaturity,
    ]) {
      const wrapper = shallowMount(component, {
        global: { stubs: { BillVoucherPage: true } },
      })
      expect(wrapper.findComponent({ name: 'BillVoucherPage' }).exists()).toBe(
        true,
      )
      wrapper.unmount()
    }
  })

  it('mounts the bill ledger page', () => {
    const wrapper = shallowMount(BillLedgerPage)
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })
})
