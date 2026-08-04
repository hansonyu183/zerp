import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  ledgerEntityConfigs,
  ledgerSourceEntityOptions,
  useLedgerViewModel,
  type LedgerReference,
} from '@/pages/led/shared'
import {
  lastCompletedMonthEnd,
  useOpeningViewModel,
} from '@/pages/led/opening/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}))

const mockedPost = vi.mocked(apiClient.post)

function reference(
  entity: string,
  suffix: string,
  extras: Partial<LedgerReference> = {},
): LedgerReference {
  return {
    objectId: `01JLED${suffix.padEnd(20, '0')}`,
    versionId: `01JLEV${suffix.padEnd(20, '0')}`,
    entity,
    code: `${entity}-${suffix}`,
    name: `${entity} ${suffix}`,
    ...extras,
  }
}

function closingView() {
  return {
    revision: 1,
    latestClosingDate: '2026-06-30',
    openingDate: '2026-07-01',
    inventory: [],
    fund: [],
    party: [],
    container: [],
  }
}

describe('LED shared ledger view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('defines the seven exact query ledgers and their backend dimensions', () => {
    expect(Object.keys(ledgerEntityConfigs)).toEqual([
      'inventory',
      'fund',
      'customer',
      'supplier',
      'other',
      'employee',
      'container',
    ])
    expect(
      ledgerEntityConfigs.inventory.referenceSources.map((item) => item.entity),
    ).toEqual(['warehouse', 'product'])
    expect(ledgerEntityConfigs.customer.referenceSources).toEqual([
      { entity: 'customer' },
    ])
    expect(ledgerEntityConfigs.supplier.referenceSources).toEqual([
      { entity: 'supplier', filters: { supplierType: 'GENERAL' } },
    ])
    expect(ledgerEntityConfigs.other.referenceSources).toEqual([
      { entity: 'other-party' },
    ])
    expect(ledgerEntityConfigs.employee.referenceSources).toEqual([
      { entity: 'employee' },
    ])
    expect(
      ledgerEntityConfigs.employee.sourceEntities.map((item) => item.value),
    ).toEqual(['employee-loan', 'employee-repayment', 'employee-loan-writeoff'])
    expect(ledgerEntityConfigs.container.directions).toEqual([])
    expect(ledgerSourceEntityOptions.map((item) => item.value)).toEqual([
      'opening',
      'sale-outbound',
      'sale-return',
      'purchase-inbound',
      'purchase-return',
      'inventory-count',
    ])
    expect(
      ledgerEntityConfigs.inventory.entryColumns.map((column) => column.label),
    ).toEqual([
      '日期',
      '入账',
      '类型',
      '单号',
      '仓库',
      '商品',
      '入库',
      '出库',
      '单位',
      '单价',
      '金额',
      '币种',
      '备注',
    ])
    const inventoryColumns = ledgerEntityConfigs.inventory.entryColumns
    const inbound = {
      direction: 'IN',
      quantity: '2.5',
      unitPrice: '10.00',
      amount: '25.00',
    }
    expect(
      inventoryColumns
        .find((column) => column.key === 'inQuantity')
        ?.value(inbound),
    ).toBe('2.5')
    expect(
      inventoryColumns
        .find((column) => column.key === 'outQuantity')
        ?.value(inbound),
    ).toBe('')
    expect(
      ledgerEntityConfigs.fund.balanceColumns.map((column) => column.label),
    ).toEqual(['账户', '性质', '金额'])
    expect(
      ledgerEntityConfigs.customer.balanceColumns.map((column) => column.label),
    ).toEqual(['往来方', '性质', '金额'])
    expect(
      ledgerEntityConfigs.container.balanceColumns.map(
        (column) => column.label,
      ),
    ).toEqual(['客户', '桶型', '欠桶'])
  })

  it('queries entries with the selected filters and exact sort contract', async () => {
    useSessionStore().permissions = [
      '/led/inventory/query',
      '/led/inventory/balance',
    ]
    mockedPost.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const scope = effectScope()
    const vm = scope.run(() =>
      useLedgerViewModel(ledgerEntityConfigs.inventory),
    )!
    const warehouse = reference('warehouse', '1')
    vm.queryFilters.dateFrom = '2026-07-01'
    vm.queryFilters.dateTo = '2026-07-25'
    vm.queryFilters.object = warehouse
    vm.queryFilters.sourceEntity = 'sale-order'
    vm.queryFilters.documentNo = ' SO-1 '
    vm.queryFilters.direction = ['OUT']
    vm.sort.field = 'documentNo'
    vm.sort.order = 'asc'

    await vm.load()

    expect(mockedPost).toHaveBeenCalledWith(
      'led/inventory/query',
      {
        page: 1,
        pageSize: 20,
        filters: {
          dateFrom: '2026-07-01',
          dateTo: '2026-07-25',
          objectId: warehouse.objectId,
          sourceEntity: 'sale-order',
          documentNo: 'SO-1',
          direction: ['OUT'],
        },
        sort: [{ field: 'documentNo', order: 'asc' }],
      },
      { signal: expect.any(AbortSignal) },
    )
    scope.stop()
  })

  it('queries a selected balance date and never calls an action without permission', async () => {
    useSessionStore().permissions = ['/led/fund/balance']
    mockedPost.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const scope = effectScope()
    const vm = scope.run(() => useLedgerViewModel(ledgerEntityConfigs.fund))!

    expect(vm.mode.value).toBe('balances')
    vm.balanceFilters.asOfDate = '2026-06-30'
    await vm.load()
    expect(mockedPost).toHaveBeenCalledWith(
      'led/fund/balance',
      {
        page: 1,
        pageSize: 20,
        filters: { asOfDate: '2026-06-30' },
      },
      { signal: expect.any(AbortSignal) },
    )

    vi.clearAllMocks()
    vm.changeMode('entries')
    expect(mockedPost).not.toHaveBeenCalled()
    expect(vm.mode.value).toBe('balances')
    scope.stop()
  })
})

describe('LED closing view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useSessionStore().permissions = [
      '/led/closing/get',
      '/led/closing/close',
      '/led/closing/unclose',
      '/led/closing/history',
    ]
  })

  it('defaults to the previous completed calendar month end', () => {
    expect(lastCompletedMonthEnd(new Date(2026, 6, 30))).toBe('2026-06-30')
    expect(lastCompletedMonthEnd(new Date(2026, 0, 15))).toBe('2025-12-31')
  })

  it('closes with the current revision and reloads the generated opening', async () => {
    mockedPost
      .mockResolvedValueOnce({ data: closingView() })
      .mockResolvedValueOnce({
        data: {
          revision: 2,
          latestClosingDate: '2026-07-31',
          openingDate: '2026-08-01',
        },
      })
      .mockResolvedValueOnce({
        data: {
          ...closingView(),
          revision: 2,
          latestClosingDate: '2026-07-31',
          openingDate: '2026-08-01',
        },
      })
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!
    await vm.load()
    vm.closingDate.value = '2026-07-31'
    expect(await vm.close()).toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'led/closing/close', {
      revision: 1,
      closingDate: '2026-07-31',
    })
    expect(vm.closing.value?.openingDate).toBe('2026-08-01')
    scope.stop()
  })

  it('requires a reason before reversing the latest closing', async () => {
    mockedPost.mockResolvedValue({ data: closingView() })
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!
    await vm.load()
    vi.clearAllMocks()

    expect(await vm.unclose()).toBe(false)
    expect(mockedPost).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe('反结账原因必填且不得超过 1000 字。')
    scope.stop()
  })

  it('loads closing history, validates pagination, and refreshes loaded history after closing', async () => {
    mockedPost
      .mockResolvedValueOnce({ data: closingView() })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'closing-1',
              closingDate: '2026-06-30',
              status: 'ACTIVE',
              createdAt: '2026-07-01T00:00:00Z',
            },
          ],
          total: 21,
          page: 1,
          pageSize: 20,
        },
      })
      .mockResolvedValueOnce({ data: { revision: 2 } })
      .mockResolvedValueOnce({
        data: {
          ...closingView(),
          revision: 2,
          latestClosingDate: '2026-07-31',
          openingDate: '2026-08-01',
        },
      })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!

    await vm.load()
    await vm.loadHistory()
    expect(vm.historyLoaded.value).toBe(true)
    expect(vm.historyItems.value).toHaveLength(1)
    expect(vm.historyPageCount.value).toBe(2)
    await vm.changeHistoryPage(0)
    await vm.changeHistoryPage(3)
    expect(mockedPost).toHaveBeenCalledTimes(2)

    vm.closingDate.value = '2026-07-31'
    expect(await vm.close()).toBe(true)
    expect(mockedPost).toHaveBeenLastCalledWith('led/closing/history', {
      page: 1,
      pageSize: 20,
    })
    scope.stop()
  })

  it('reverses the latest closing and resets the dialog', async () => {
    mockedPost
      .mockResolvedValueOnce({ data: closingView() })
      .mockResolvedValueOnce({ data: { revision: 2 } })
      .mockResolvedValueOnce({
        data: {
          ...closingView(),
          revision: 2,
          latestClosingDate: null,
          openingDate: null,
        },
      })
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!
    await vm.load()
    vm.uncloseDialog.value = true
    vm.uncloseReason.value = '  发现月末单据遗漏  '

    expect(await vm.unclose()).toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'led/closing/unclose', {
      revision: 1,
      reason: '发现月末单据遗漏',
    })
    expect(vm.successMessage.value).toBe('已反结最近一期。')
    expect(vm.closingDate.value).toBe('2026-06-30')
    expect(vm.uncloseDialog.value).toBe(false)
    expect(vm.uncloseReason.value).toBe('')
    scope.stop()
  })

  it('reports API failures and always clears loading state', async () => {
    mockedPost.mockRejectedValueOnce(new Error('结账状态读取失败'))
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!

    await vm.load()
    expect(vm.errorMessage.value).toBe('结账状态读取失败')
    expect(vm.loading.value).toBe(false)

    vm.closing.value = closingView()
    mockedPost.mockRejectedValueOnce(new Error('结账失败'))
    expect(await vm.close()).toBe(false)
    expect(vm.errorMessage.value).toBe('结账失败')
    expect(vm.saving.value).toBe(false)

    mockedPost.mockRejectedValueOnce(new Error('历史读取失败'))
    await vm.loadHistory()
    expect(vm.errorMessage.value).toBe('历史读取失败')
    expect(vm.historyLoading.value).toBe(false)

    vm.uncloseReason.value = '更正'
    mockedPost.mockRejectedValueOnce(new Error('反结账失败'))
    expect(await vm.unclose()).toBe(false)
    expect(vm.errorMessage.value).toBe('反结账失败')
    expect(vm.saving.value).toBe(false)
    scope.stop()
  })

  it('does not call closing APIs without permission or required state', async () => {
    useSessionStore().permissions = []
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!

    await vm.load()
    await vm.loadHistory()
    expect(await vm.close()).toBe(false)
    expect(await vm.unclose()).toBe(false)
    expect(mockedPost).not.toHaveBeenCalled()

    useSessionStore().permissions = [
      '/led/closing/get',
      '/led/closing/close',
      '/led/closing/unclose',
    ]
    vm.closing.value = closingView()
    vm.closingDate.value = ''
    expect(await vm.close()).toBe(false)
    vm.uncloseReason.value = '超'.repeat(1001)
    expect(await vm.unclose()).toBe(false)
    expect(mockedPost).not.toHaveBeenCalled()
    scope.stop()
  })
})
