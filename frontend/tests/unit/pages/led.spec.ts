import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  ledgerEntityConfigs,
  useLedgerViewModel,
  type LedgerReference,
} from '@/components/ledger'
import {
  openingEventLabel,
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

function openingView() {
  return {
    status: 'DRAFT' as const,
    revision: 1,
    cutoverDate: '2026-07-01',
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

  it('defines the four exact query ledgers and their backend dimensions', () => {
    expect(Object.keys(ledgerEntityConfigs)).toEqual([
      'inventory',
      'fund',
      'party',
      'container',
    ])
    expect(ledgerEntityConfigs.inventory.referenceSources.map(
      (item) => item.entity,
    )).toEqual(['warehouse', 'product'])
    expect(ledgerEntityConfigs.party.referenceSources).toEqual([
      { entity: 'customer' },
      { entity: 'supplier', filters: { supplierType: 'GENERAL' } },
    ])
    expect(ledgerEntityConfigs.container.directions).toEqual([])
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
      useLedgerViewModel(ledgerEntityConfigs.inventory))!
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

  it('uses today for balance and never calls an action without permission', async () => {
    useSessionStore().permissions = ['/led/fund/balance']
    mockedPost.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const scope = effectScope()
    const vm = scope.run(() =>
      useLedgerViewModel(ledgerEntityConfigs.fund))!

    expect(vm.mode.value).toBe('balances')
    await vm.load()
    expect(mockedPost).toHaveBeenCalledWith(
      'led/fund/balance',
      {
        page: 1,
        pageSize: 20,
        filters: { asOfDate: vm.balanceFilters.asOfDate },
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

describe('LED opening view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useSessionStore().permissions = [
      '/led/opening/get',
      '/led/opening/save',
      '/led/opening/activate',
      '/led/opening/reopen',
      '/led/opening/cancel-reopen',
      '/led/opening/audit-history',
    ]
  })

  it('translates the exact backend opening audit event names', () => {
    expect(openingEventLabel('OPENING_SAVED')).toBe('保存期初')
    expect(openingEventLabel('ACTIVATED')).toBe('启用账簿')
    expect(openingEventLabel('REOPENED')).toBe('重开账簿')
    expect(openingEventLabel('REOPEN_CANCELLED')).toBe('取消重开')
    expect(openingEventLabel('FUTURE_EVENT')).toBe('FUTURE_EVENT')
  })

  it('builds the complete opening payload with object and version references', async () => {
    mockedPost.mockResolvedValue({ data: openingView() })
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!
    await vm.load()
    const warehouse = reference('warehouse', '1')
    const product = reference('product', '2')
    const fundAccount = reference('fund-account', '3')
    const customer = reference('customer', '4')

    vm.addInventory()
    vm.form.inventory[0]!.warehouse = warehouse
    vm.form.inventory[0]!.product = product
    vm.form.inventory[0]!.quantity = '12.345600'
    vm.addFund()
    vm.form.fund[0]!.fundAccount = fundAccount
    vm.form.fund[0]!.balanceType = 'OVERDRAFT'
    vm.form.fund[0]!.amount = '10.20'
    vm.addParty()
    vm.form.party[0]!.counterparty = customer
    vm.form.party[0]!.currency = 'cny'
    vm.form.party[0]!.amount = '30.00'
    vm.addContainer()
    vm.form.container[0]!.customer = customer
    vm.form.container[0]!.containerType = 'RESIN'
    vm.form.container[0]!.quantity = '8'

    expect(vm.savePayload()).toEqual({
      revision: 1,
      cutoverDate: '2026-07-01',
      inventory: [{
        warehouse: {
          objectId: warehouse.objectId,
          versionId: warehouse.versionId,
        },
        product: {
          objectId: product.objectId,
          versionId: product.versionId,
        },
        quantity: '12.345600',
      }],
      fund: [{
        fundAccount: {
          objectId: fundAccount.objectId,
          versionId: fundAccount.versionId,
        },
        balanceType: 'OVERDRAFT',
        amount: '10.20',
      }],
      party: [{
        counterpartyType: 'customer',
        counterparty: {
          objectId: customer.objectId,
          versionId: customer.versionId,
        },
        currency: 'CNY',
        balanceType: 'RECEIVABLE',
        amount: '30.00',
      }],
      container: [{
        customer: {
          objectId: customer.objectId,
          versionId: customer.versionId,
        },
        containerType: 'RESIN',
        quantity: 8,
      }],
    })
    scope.stop()
  })

  it('rejects duplicate dimensions before a save request', async () => {
    mockedPost.mockResolvedValue({ data: openingView() })
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!
    await vm.load()
    const warehouse = reference('warehouse', '1')
    const product = reference('product', '2')
    vm.addInventory()
    vm.addInventory()
    for (const row of vm.form.inventory) {
      row.warehouse = warehouse
      row.product = product
      row.quantity = '1'
    }

    expect(vm.savePayload()).toBeNull()
    expect(vm.errorMessage.value).toBe(
      '库存期初存在重复的仓库和商品组合。',
    )
    scope.stop()
  })

  it('uses the current revision for activation and refreshes server state', async () => {
    mockedPost
      .mockResolvedValueOnce({ data: openingView() })
      .mockResolvedValueOnce({
        data: { status: 'ACTIVE', revision: 2, generationId: 'GEN-1' },
      })
      .mockResolvedValueOnce({
        data: {
          ...openingView(),
          status: 'ACTIVE',
          revision: 2,
          activeGenerationId: 'GEN-1',
        },
      })
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!
    await vm.load()

    expect(await vm.activate()).toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(
      2,
      'led/opening/activate',
      { revision: 1 },
    )
    expect(vm.opening.value?.status).toBe('ACTIVE')
    scope.stop()
  })

  it('blocks activation while the visible opening form has unsaved changes', async () => {
    mockedPost.mockResolvedValue({ data: openingView() })
    const scope = effectScope()
    const vm = scope.run(() => useOpeningViewModel())!
    await vm.load()
    vm.form.cutoverDate = '2026-07-02'
    vi.clearAllMocks()

    expect(await vm.activate()).toBe(false)
    expect(mockedPost).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe(
      '期初存在未保存修改，请先保存再启用账簿。',
    )
    scope.stop()
  })
})
