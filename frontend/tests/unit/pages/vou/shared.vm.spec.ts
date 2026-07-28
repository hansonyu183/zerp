import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type {
  VoucherDocumentView,
  VoucherDraftForm,
  VoucherEntityConfig,
  VoucherReference,
} from '@/components/voucher'
import { voucherEntityConfigs } from '@/pages/vou/shared/config'
import { useVoucherEntityViewModel } from '@/pages/vou/shared/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    uploadAttachment: vi.fn(),
    fetchAttachment: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedPost = vi.mocked(apiClient.post)

const reference = (
  entity: string,
  code = entity.toUpperCase(),
): VoucherReference => ({
  objectId: `${entity}-object`,
  versionId: `${entity}-version`,
  entity,
  code,
  name: `${entity} name`,
  ...(entity === 'fund-account' ? { currency: 'CNY' } : {}),
})

function documentView(
  config: VoucherEntityConfig,
  form: VoucherDraftForm,
): VoucherDocumentView {
  return {
    documentId: 'DOCUMENT-1',
    entity: config.entity,
    documentNo: 'DOC-1',
    status: 'DRAFT',
    revision: 1,
    amount: form.amount || '10.00',
    data: {
      businessDate: form.businessDate,
      currency: form.currency,
      remark: form.remark,
      ...(form.customer ? { customer: form.customer } : {}),
      ...(form.supplier ? { supplier: form.supplier } : {}),
      ...(form.counterparty ? { counterparty: form.counterparty } : {}),
      ...(form.employee ? { employee: form.employee } : {}),
      ...(form.salesperson ? { salesperson: form.salesperson } : {}),
      ...(form.purchaser ? { purchaser: form.purchaser } : {}),
      ...(form.handler ? { handler: form.handler } : {}),
      ...(form.warehouse ? { warehouse: form.warehouse } : {}),
      ...(form.fundAccount ? { fundAccount: form.fundAccount } : {}),
      sourceName: form.sourceName,
      productLines: form.productLines.map((line, index) => ({
        lineId: `LINE-${index}`,
        lineNo: index + 1,
        product: line.product!,
        orderedQuantity: line.orderedQuantity,
        unitPrice: line.unitPrice,
        ...(line.purchaseUnitPrice
          ? { purchaseUnitPrice: line.purchaseUnitPrice }
          : {}),
        lineAmount: '10.00',
        remark: line.remark,
      })),
      expenseLines: form.expenseLines.map((line, index) => ({
        lineId: `EXP-${index}`,
        lineNo: index + 1,
        category: line.category,
        description: line.description,
        amount: line.amount,
        remark: line.remark,
      })),
    },
    attachments: [],
    createdAt: '2026-07-24T00:00:00Z',
    createdBy: 'USER-1',
    updatedAt: '2026-07-24T00:00:00Z',
    updatedBy: 'USER-1',
  }
}

function populate(config: VoucherEntityConfig, form: VoucherDraftForm): void {
  form.businessDate = '2026-07-24'
  form.currency = 'CNY'
  form.remark = 'test'
  if (config.partyMode === 'customer' || config.partyMode === 'dual') {
    form.customer = reference('customer')
  }
  if (config.partyMode === 'supplier' || config.partyMode === 'dual') {
    form.supplier = reference('supplier')
  }
  if (config.partyMode === 'counterparty') {
    form.counterpartyType = 'customer'
    form.counterparty = reference('customer')
  }
  if (config.usesSalesperson) form.salesperson = reference('employee', 'SALE')
  if (config.usesPurchaser) form.purchaser = reference('employee', 'BUYER')
  if (config.usesWarehouse) form.warehouse = reference('warehouse')
  if (config.usesEmployee) form.employee = reference('employee')
  if (config.usesHandler) form.handler = reference('employee')
  if (config.usesFundAccount) form.fundAccount = reference('fund-account')
  if (config.usesSourceName) form.sourceName = '其它收入来源'
  if (config.directAmount) form.amount = '10.00'
  if (config.lineKind === 'product') {
    form.productLines = [
      {
        key: 'line',
        product: reference('product'),
        orderedQuantity: '2.5',
        unitPrice: '4.00',
        purchaseUnitPrice:
          config.entity === 'intermediary-sale-order' ? '3.00' : '',
        remark: '',
      },
    ]
  }
  if (config.lineKind === 'expense') {
    form.expenseLines = [
      {
        key: 'expense',
        category: '交通',
        description: '出差交通',
        amount: '10.00',
        remark: '',
      },
    ]
  }
}

describe('shared VOU entity view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('defines all fifteen atomic document entities', () => {
    expect(Object.keys(voucherEntityConfigs)).toEqual([
      'sale-order',
      'sale-outbound',
      'sale-delivery',
      'sale-signoff',
      'purchase-order',
      'intermediary-sale-order',
      'receipt',
      'payment',
      'expense-reimbursement',
      'other-income',
      'customer-order',
      'procurement-order',
      'goods-receipt',
      'delivery-note',
      'signoff-note',
    ])
    expect(voucherEntityConfigs['sale-outbound'].icon).toBe('mdi-tray-arrow-up')
    expect(voucherEntityConfigs['sale-order'].managedByWorkflow).toBe('sales-fulfillment')
    expect(voucherEntityConfigs['customer-order'].managedByWorkflow).toBe('intermediary-trade')
  })

  it('builds entity-specific create payloads without dueDate or unrelated fields', async () => {
    for (const config of Object.values(voucherEntityConfigs).filter(
      (item) => !item.sourceEntity,
    )) {
      vi.clearAllMocks()
      useSessionStore().permissions = [`/vou/${config.entity}/create`]
      const vm = useVoucherEntityViewModel(config)
      vm.openCreate()
      populate(config, vm.form.value)
      let captured: Record<string, unknown> | undefined

      mockedPost.mockImplementation(async (path, body) => {
        if (path.endsWith('/create')) {
          captured = body as Record<string, unknown>
          return {
            data: {
              documentId: 'DOCUMENT-1',
              documentNo: 'DOC-1',
              status: 'DRAFT',
              revision: 1,
            },
          }
        }
        if (path.endsWith('/get')) {
          return { data: documentView(config, vm.form.value) }
        }
        return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
      })

      expect(await vm.save()).toBe(true)
      const data = captured?.data as Record<string, unknown>
      expect(data).not.toHaveProperty('dueDate')
      expect(data).not.toHaveProperty('outboundDate')
      expect(data).not.toHaveProperty('inboundDate')
      expect(data).toHaveProperty('businessDate', '2026-07-24')
      if (config.lineKind !== 'product')
        expect(data).not.toHaveProperty('productLines')
      if (config.lineKind !== 'expense')
        expect(data).not.toHaveProperty('expenseLines')
      if (!config.directAmount) expect(data).not.toHaveProperty('amount')
      if (config.lineKind === 'product') {
        const productLine = (
          data.productLines as Array<Record<string, unknown>>
        )[0]
        if (config.entity === 'intermediary-sale-order') {
          expect(productLine).toHaveProperty('purchaseUnitPrice', '3.00')
          expect(vm.form.value.productLines[0].purchaseUnitPrice).toBe('3.00')
        } else {
          expect(productLine).not.toHaveProperty('purchaseUnitPrice')
        }
      }
    }
  })

  it('loads a finalized order and creates an outbound batch with source lines', async () => {
    const config = voucherEntityConfigs['sale-outbound']
    const orderConfig = voucherEntityConfigs['sale-order']
    const orderForm = useVoucherEntityViewModel(orderConfig).form.value
    populate(orderConfig, orderForm)
    const order = documentView(orderConfig, orderForm)
    order.documentId = 'ORDER-1'
    order.documentNo = 'SO-20260724-000001'
    order.status = 'FINALIZED'
    order.data.productLines![0].availableQuantity = '6.0'

    useSessionStore().permissions = ['/vou/sale-outbound/create']
    const vm = useVoucherEntityViewModel(config)
    let captured: Record<string, unknown> | undefined
    mockedPost.mockImplementation(async (path, body) => {
      if (path === 'vou/sale-order/query') {
        return {
          data: {
            items: [
              {
                documentId: order.documentId,
                entity: order.entity,
                documentNo: order.documentNo,
                status: order.status,
                revision: order.revision,
                businessDate: order.data.businessDate,
                currency: order.data.currency,
                amount: order.amount,
                updatedAt: order.updatedAt,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 50,
          },
        }
      }
      if (path === 'vou/sale-order/get') return { data: order }
      if (path === 'vou/sale-outbound/create') {
        captured = body as Record<string, unknown>
        return {
          data: {
            documentId: 'OUTBOUND-1',
            documentNo: 'SOB-20260724-000001',
            status: 'DRAFT',
            revision: 1,
          },
        }
      }
      if (path === 'vou/sale-outbound/get') {
        return { data: documentView(config, vm.form.value) }
      }
      return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
    })

    vm.openCreate()
    await vm.searchSourceDocuments('SO-20260724')
    await vm.selectSourceDocument(order.documentId)
    expect(vm.form.value.salesChainLines).toHaveLength(1)
    expect(vm.form.value.salesChainLines[0]).toMatchObject({
      sourceLineId: 'LINE-0',
      availableQuantity: '6.0',
      quantity: '6.0',
    })

    vm.form.value.businessDate = '2026-07-25'
    vm.form.value.warehouse = reference('warehouse')
    vm.form.value.salesChainLines[0].quantity = '4'
    expect(await vm.save()).toBe(true)
    expect(captured).toEqual({
      data: {
        businessDate: '2026-07-25',
        currency: 'CNY',
        sourceDocumentId: 'ORDER-1',
        warehouse: {
          objectId: 'warehouse-object',
          versionId: 'warehouse-version',
        },
        sourceLines: [
          {
            sourceLineId: 'LINE-0',
            quantity: '4',
          },
        ],
      },
    })
  })

  it('requires a purchase unit price for intermediary sale order lines', async () => {
    const config = voucherEntityConfigs['intermediary-sale-order']
    useSessionStore().permissions = [`/vou/${config.entity}/create`]
    const vm = useVoucherEntityViewModel(config)
    vm.openCreate()
    populate(config, vm.form.value)
    vm.form.value.productLines[0].purchaseUnitPrice = ''

    expect(await vm.save()).toBe(false)
    expect(vm.workspaceError.value).toBe('第 1 行 · 采购单价：格式不正确。')
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('loads and saves an intermediary purchase unit price', async () => {
    const config = voucherEntityConfigs['intermediary-sale-order']
    const form = useVoucherEntityViewModel(config).form.value
    populate(config, form)
    const view = documentView(config, form)
    useSessionStore().permissions = [
      `/vou/${config.entity}/get`,
      `/vou/${config.entity}/save`,
    ]
    const vm = useVoucherEntityViewModel(config)
    let savedData: Record<string, unknown> | undefined
    mockedPost.mockImplementation(async (path, body) => {
      if (path.endsWith('/get')) return { data: view }
      if (path.endsWith('/save')) {
        savedData = (body as { data: Record<string, unknown> }).data
        return {
          data: {
            documentId: view.documentId,
            documentNo: view.documentNo,
            status: 'DRAFT',
            revision: 2,
          },
        }
      }
      return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
    })

    await vm.openDocument(
      {
        documentId: view.documentId,
        entity: config.entity,
        documentNo: view.documentNo,
        status: 'DRAFT',
        revision: 1,
        businessDate: form.businessDate,
        currency: form.currency,
        amount: view.amount,
        updatedAt: view.updatedAt,
      },
      true,
    )
    expect(vm.form.value.productLines[0].purchaseUnitPrice).toBe('3.00')

    vm.form.value.productLines[0].purchaseUnitPrice = '3.25'
    expect(await vm.save()).toBe(true)
    expect(
      (savedData?.productLines as Array<Record<string, unknown>>)[0],
    ).toHaveProperty('purchaseUnitPrice', '3.25')
  })

  it('keeps workflow-managed documents read-only even with legacy write permissions', async () => {
    const config = voucherEntityConfigs['sale-order']
    useSessionStore().permissions = [
      '/vou/sale-order/query',
      '/vou/sale-order/get',
      '/vou/sale-order/create',
      '/vou/sale-order/save',
      '/vou/sale-order/check',
      '/vou/sale-order/attachment-initiate',
      '/vou/sale-order/attachment-remove',
    ]
    const vm = useVoucherEntityViewModel(config)
    expect(vm.canCreate.value).toBe(false)
    expect(vm.canEdit({
      documentId: 'DOCUMENT-1',
      entity: config.entity,
      documentNo: 'SO-1',
      status: 'DRAFT',
      revision: 1,
      businessDate: '2026-07-24',
      currency: 'CNY',
      amount: '10.00',
      updatedAt: '2026-07-24T00:00:00Z',
    })).toBe(false)
    expect(vm.actionAvailability.value.save).toBe(false)
    expect(vm.actionAvailability.value.check).toBe(false)
    expect(vm.actionAvailability.value.attachmentInitiate).toBe(false)
    expect(vm.actionAvailability.value.attachmentRemove).toBe(false)
  })

  it('only exposes matching effective BOB object and version pairs', async () => {
    vi.useFakeTimers()
    useSessionStore().permissions = ['/bob/customer/query']
    const vm = useVoucherEntityViewModel(voucherEntityConfigs.receipt)
    mockedPost.mockResolvedValue({
      data: {
        items: [
          {
            objectId: 'VALID',
            code: 'CUS-1',
            effectiveVersionId: 'VER-1',
            currentVersion: {
              versionId: 'VER-1',
              status: 'EFFECTIVE',
              summary: { name: '有效客户' },
            },
          },
          {
            objectId: 'MISMATCH',
            code: 'CUS-2',
            effectiveVersionId: 'VER-OLD',
            currentVersion: {
              versionId: 'VER-DRAFT',
              status: 'DRAFT',
              summary: { name: '编辑中的客户' },
            },
          },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      },
    })

    vm.searchReference('counterparty', 'CUS')
    await vi.advanceTimersByTimeAsync(250)

    expect(vm.referenceOptions('counterparty')).toEqual([
      {
        objectId: 'VALID',
        versionId: 'VER-1',
        entity: 'customer',
        code: 'CUS-1',
        name: '有效客户',
      },
    ])
    vi.useRealTimers()
  })

  it('filters delivery vehicles by the selected platform without an unsupported BOB filter', async () => {
    vi.useFakeTimers()
    useSessionStore().permissions = ['/bob/vehicle/query']
    const vm = useVoucherEntityViewModel(voucherEntityConfigs['sale-delivery'])
    vm.form.value.platform = reference('supplier')
    const requests: Array<Record<string, unknown>> = []
    mockedPost.mockImplementation(async (_path, body) => {
      requests.push(body as Record<string, unknown>)
      return {
        data: {
          items: [
            {
              objectId: 'MATCHING',
              code: 'VEH-1',
              effectiveVersionId: 'VER-1',
              currentVersion: {
                versionId: 'VER-1',
                status: 'EFFECTIVE',
                summary: {
                  name: '匹配车辆',
                  platformObjectId: 'supplier-object',
                },
              },
            },
            {
              objectId: 'OTHER',
              code: 'VEH-2',
              effectiveVersionId: 'VER-2',
              currentVersion: {
                versionId: 'VER-2',
                status: 'EFFECTIVE',
                summary: {
                  name: '其它车辆',
                  platformObjectId: 'other-platform',
                },
              },
            },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      }
    })

    vm.searchReference('vehicle', 'VEH')
    await vi.advanceTimersByTimeAsync(250)

    expect(requests[0].filters as Record<string, unknown>).not.toHaveProperty(
      'platformObjectId',
    )
    expect(vm.referenceOptions('vehicle')).toEqual([
      {
        objectId: 'MATCHING',
        versionId: 'VER-1',
        entity: 'vehicle',
        code: 'VEH-1',
        name: '匹配车辆',
        platformObjectId: 'supplier-object',
      },
    ])
    vi.useRealTimers()
  })

  it('derives lifecycle actions from exact status and permission paths', async () => {
    const config = voucherEntityConfigs.payment
    const view = documentView(config, {
      ...useVoucherEntityViewModel(config).form.value,
      counterpartyType: 'customer',
      counterparty: reference('customer'),
      fundAccount: reference('fund-account'),
      handler: reference('employee'),
      currency: 'CNY',
      amount: '10.00',
    })
    view.status = 'CHECKED'
    useSessionStore().permissions = [
      '/vou/payment/get',
      '/vou/payment/approve',
      '/vou/payment/uncheck',
    ]
    mockedPost.mockResolvedValue({ data: view })
    const vm = useVoucherEntityViewModel(config)

    await vm.openDocument({
      documentId: view.documentId,
      entity: config.entity,
      documentNo: view.documentNo,
      status: 'CHECKED',
      revision: 1,
      businessDate: '2026-07-24',
      currency: 'CNY',
      amount: '10.00',
      updatedAt: '2026-07-24T00:00:00Z',
    })

    expect(vm.actionAvailability.value).toMatchObject({
      approve: true,
      uncheck: true,
      check: false,
      finalize: false,
      unapprove: false,
    })
  })

  it('keeps list and workspace navigation behavior stable', async () => {
    const config = voucherEntityConfigs.receipt
    useSessionStore().permissions = [
      '/vou/receipt/query',
      '/vou/receipt/get',
      '/vou/receipt/save',
    ]
    const vm = useVoucherEntityViewModel(config)
    populate(config, vm.form.value)
    const view = documentView(config, vm.form.value)
    const row = {
      documentId: view.documentId,
      entity: config.entity,
      documentNo: view.documentNo,
      status: 'DRAFT' as const,
      revision: view.revision,
      businessDate: vm.form.value.businessDate,
      currency: vm.form.value.currency,
      amount: view.amount,
      updatedAt: view.updatedAt,
    }
    mockedPost.mockImplementation(async (path) => {
      if (path.endsWith('/get')) return { data: view }
      return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
    })

    expect(vm.canEdit(row)).toBe(true)
    await vm.search()
    await vm.changePage(2)
    vm.filters.keyword = ' receipt '
    vm.selectedParty.value = reference('customer')
    await vm.resetFilters()
    expect(vm.filters.keyword).toBe('')
    expect(vm.selectedParty.value).toBeNull()

    await vm.openDocument(row, true)
    vm.startEditing()
    vm.form.value.fundAccount = reference('fund-account')
    vm.markReferenceChanged('fundAccount')
    expect(vm.form.value.currency).toBe('CNY')
    vm.cancelEditing()
    await vm.reloadDocument()
    vm.closeWorkspace()
    expect(vm.workspaceOpen.value).toBe(false)
    expect(vm.documentView.value).toBeNull()
  })
})
