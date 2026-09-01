import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import type {
  VoucherDocumentView,
  VoucherDraftForm,
  VoucherEntityConfig,
  VoucherReference,
} from '@/components/voucher'
import { voucherEntityConfigs } from '@/pages/vou/shared/config'
import { formFromDocument } from '@/pages/vou/shared/form'
import { buildVoucherDraftPayload } from '@/pages/vou/shared/payload'
import { useVoucherEntityViewModel } from '@/pages/vou/shared/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => {
  const postContract = vi.fn()
  return {
    apiClient: {
      postContract,
      uploadAttachment: vi.fn(),
      fetchAttachment: vi.fn(),
      setCsrfToken: vi.fn(),
    },
  }
})

const mockedPost = vi.mocked(apiClient.postContract)

const reference = (
  entity: string,
  code = entity.toUpperCase(),
): VoucherReference => ({
  objectId: `${entity}-object`,
  approvalEntryId: `${entity}-version`,
  entity,
  code,
  name: `${entity} name`,
  ...(entity === 'fund-account' ? { currency: 'CNY' } : {}),
  ...(entity === 'product'
    ? {
        behaviorProfile: 'RAW_MATERIAL' as const,
        defaultInputUnitId: 'unit-kg',
        pricingUnitId: 'unit-kg',
        unitConversions: [
          {
            unit: {
              objectId: 'unit-kg',
              code: 'UNT-0001',
              name: '千克',
              symbol: 'kg',
            },
            factor: '1',
          },
        ],
      }
    : {}),
})

function documentView(
  config: VoucherEntityConfig,
  form: VoucherDraftForm,
): VoucherDocumentView {
  return {
    documentId: 'DOCUMENT-1',
    entity: config.entity,
    documentNo: 'DOC-1',
    availableApprovalActions: ['submit'],
    approval: {
      status: 'DRAFT',
      revision: 1,
      createdAt: '2026-07-24T00:00:00Z',
      createdBy: 'USER-1',
      updatedAt: '2026-07-24T00:00:00Z',
      updatedBy: 'USER-1',
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
    },
    amount: form.amount || '10.00',
    data: {
      businessDate: form.businessDate,
      currency: form.currency,
      remark: form.remark,
      ...(form.customer ? { customer: form.customer } : {}),
      ...(form.operatingEntity
        ? { operatingEntity: form.operatingEntity }
        : {}),
      ...(form.supplier ? { supplier: form.supplier } : {}),
      ...(form.counterparty ? { counterparty: form.counterparty } : {}),
      ...(form.employee ? { employee: form.employee } : {}),
      ...(form.salesperson ? { salesperson: form.salesperson } : {}),
      ...(form.purchaser ? { purchaser: form.purchaser } : {}),
      ...(form.handler ? { handler: form.handler } : {}),
      ...(form.warehouse ? { warehouse: form.warehouse } : {}),
      ...(form.materialWarehouse
        ? { materialWarehouse: form.materialWarehouse }
        : {}),
      ...(form.finishedWarehouse
        ? { finishedWarehouse: form.finishedWarehouse }
        : {}),
      ...(form.fundAccount ? { fundAccount: form.fundAccount } : {}),
      accountAllocations: form.accountAllocations.map((line) => ({
        account: line.account!,
        amount: line.amount,
      })),
      sourceName: form.sourceName,
      productLines: form.productLines.map((line, index) => ({
        lineId: `LINE-${index}`,
        lineNo: index + 1,
        product: line.product!,
        enteredQuantity: line.enteredQuantity,
        enteredUnit: line.enteredUnit!,
        baseQuantity: line.baseQuantity,
        unitPrice: line.unitPrice,
        ...(line.purchaseUnitPrice
          ? { purchaseUnitPrice: line.purchaseUnitPrice }
          : {}),
        lineAmount: '10.00',
        remark: line.remark,
      })),
      priceLines: form.priceLines.map((line, index) => ({
        lineId: `PRICE-${index}`,
        lineNo: index + 1,
        product: line.product!,
        unitPrice: line.unitPrice,
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
      assetAcquisitionLines:
        config.lineKind === 'asset-acquisition'
          ? form.assetLines.map((line, index) => ({
              ...line,
              lineId: `ASSET-${index}`,
              lineNo: index + 1,
            }))
          : [],
      assetSaleLines:
        config.lineKind === 'asset-sale'
          ? form.assetLines.map((line, index) => ({
              ...line,
              lineId: `ASSET-${index}`,
              lineNo: index + 1,
            }))
          : [],
      assetLiquidationLines:
        config.lineKind === 'asset-liquidation'
          ? form.assetLines.map((line, index) => ({
              ...line,
              lineId: `ASSET-${index}`,
              lineNo: index + 1,
            }))
          : [],
      productionLines: form.productionLines.map((line, index) => ({
        lineId: `PRODUCTION-${index}`,
        lineNo: index + 1,
        sourceOrderLineId: line.sourceOrderLineId,
        product: line.product!,
        enteredQuantity: line.enteredQuantity,
        enteredUnit: line.enteredUnit!,
        baseQuantity: line.baseQuantity,
        lossRate: line.lossRate,
        formulaBaseQuantity: line.formulaBaseQuantity,
        remark: line.remark,
        materials: line.materials.map((material, materialIndex) => ({
          lineId: `MATERIAL-${materialIndex}`,
          lineNo: material.formulaLineNo,
          formulaMaterial: material.formulaMaterial,
          formulaBaseQuantity: material.formulaBaseQuantity,
          suggestedBaseQuantity: material.suggestedBaseQuantity,
          actualMaterial: material.actualMaterial!,
          actualEnteredQuantity: material.actualEnteredQuantity,
          actualEnteredUnit: material.actualEnteredUnit!,
          actualBaseQuantity: material.actualBaseQuantity,
          adjustmentReason: material.adjustmentReason,
        })),
      })),
      inventoryCountLines: form.inventoryCountLines.map((line, index) => ({
        lineId: `COUNT-${index}`,
        lineNo: index + 1,
        product: line.product!,
        enteredQuantity: line.enteredQuantity,
        enteredUnit: line.enteredUnit!,
        baseQuantity: line.baseQuantity,
        bookBaseQuantity: line.bookBaseQuantity,
        differenceBaseQuantity: line.differenceBaseQuantity,
        remark: line.remark,
      })),
    },
    attachments: [],
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
    form.counterpartyType = config.fixedCounterpartyType ?? 'customer'
    form.counterparty = reference(config.fixedCounterpartyType ?? 'customer')
  }
  if (config.usesSalesperson) form.salesperson = reference('employee', 'SALE')
  if (config.usesPurchaser) form.purchaser = reference('employee', 'BUYER')
  if (config.usesWarehouse) form.warehouse = reference('warehouse')
  if (config.usesEmployee) form.employee = reference('employee')
  if (config.usesHandler) form.handler = reference('employee')
  if (config.usesFundAccount) form.fundAccount = reference('fund-account')
  if (config.usesOperatingEntity) {
    form.operatingEntity = reference('operating-entity')
  }
  if (config.usesAccountAllocations) {
    form.accountAllocations = [
      {
        key: 'allocation-1',
        account: {
          ...reference('customer-account'),
          customerId: form.customer?.objectId,
        },
        amount: '10.00',
      },
    ]
  }
  if (config.usesSourceName) form.sourceName = '其他收入来源'
  if (config.directAmount) form.amount = '10.00'
  if (config.entity === 'intermediary-calculation') {
    form.businessDate = '2026-07-31'
    form.intermediaryCalculation = {
      source: {
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        currency: 'CNY',
        lines: [],
        bills: [],
      },
      sourceHash: 'source-hash',
      script: {
        scriptId: 'script-1',
        revision: 1,
        name: '测试脚本',
        source: 'globalThis.calculate = () => ({ lines: [], summaries: [] });',
        hash: 'script-hash',
      },
      result: { lines: [], summaries: [] },
    }
  }
  if (config.productionMode) {
    const warehouse = reference('warehouse')
    const product = {
      ...reference('product', 'FG-001'),
      behaviorProfile: 'STANDARD_FINISHED',
    }
    const material = {
      ...reference('product', 'RM-001'),
      behaviorProfile: 'RAW_MATERIAL',
    }
    form.materialWarehouse = warehouse
    form.finishedWarehouse = warehouse
    form.productionLines = [
      {
        key: 'production-line',
        sourceOrderLineId: '',
        product,
        enteredQuantity: '10',
        enteredUnit: {
          objectId: 'unit-kg',
          code: 'UNT-0001',
          name: '千克',
          symbol: 'kg',
        },
        baseQuantity: '10',
        lossRate: '0',
        formulaBaseQuantity: '1',
        remark: '',
        materials: [
          {
            key: 'material-line',
            formulaLineNo: 1,
            formulaMaterial: material,
            formulaBaseQuantity: '2',
            suggestedBaseQuantity: '20',
            actualMaterial: material,
            actualEnteredQuantity: '20',
            actualEnteredUnit: {
              objectId: 'unit-kg',
              code: 'UNT-0001',
              name: '千克',
              symbol: 'kg',
            },
            actualBaseQuantity: '20',
            adjustmentReason: '',
          },
        ],
      },
    ]
  }
  if (config.lineKind === 'product') {
    const product = {
      ...reference('product'),
      behaviorProfile: 'RAW_MATERIAL',
    }
    form.productLines = [
      {
        key: 'line',
        product,
        enteredQuantity: '2.5',
        enteredUnit: {
          objectId: 'unit-kg',
          code: 'UNT-0001',
          name: '千克',
          symbol: 'kg',
        },
        baseQuantity: '2.5',
        unitPrice: '4.00',
        settlementSurcharge: '',
        purchaseUnitPrice: '',
        deliverySpecificationType:
          config.entity === 'sale-order' ? 'BULK_LIQUID' : 'PACKAGED',
        remark: '',
        ...(config.entity === 'sale-order'
          ? {
              formula: {
                output: {
                  enteredQuantity: '1',
                  enteredUnit: {
                    objectId: 'unit-kg',
                    code: 'UNT-0001',
                    name: '千克',
                    symbol: 'kg',
                  },
                  baseQuantity: '1',
                },
                sourceType: 'RAW_SELF',
                components: [
                  {
                    key: 'formula-line',
                    material: product,
                    quantity: {
                      enteredQuantity: '1',
                      enteredUnit: {
                        objectId: 'unit-kg',
                        code: 'UNT-0001',
                        name: '千克',
                        symbol: 'kg',
                      },
                      baseQuantity: '1',
                    },
                  },
                ],
              },
            }
          : {}),
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
  if (config.lineKind === 'price') {
    form.priceLines = [
      {
        key: 'price',
        product: { ...reference('product'), unit: 'kg' },
        unitPrice: '4.00',
        remark: '',
      },
    ]
  }
  if (config.lineKind === 'inventory-count') {
    form.inventoryCountLines = [
      {
        key: 'inventory-count',
        product: reference('product'),
        enteredQuantity: '2.5',
        enteredUnit: {
          objectId: 'unit-kg',
          code: 'UNT-0001',
          name: '千克',
          symbol: 'kg',
        },
        baseQuantity: '2.5',
        bookBaseQuantity: '2',
        remark: '',
      },
    ]
  }
  if (config.lineKind.startsWith('asset-')) {
    form.assetLines = [
      {
        key: 'asset-line',
        assetId: '01J00000000000000000000002',
        assetNo: 'AST-001',
        assetName: '测试设备',
        specification: '',
        category: reference('asset-category'),
        department: reference('department'),
        custodian: null,
        originalValue: '1200.00',
        usefulLifeMonths: '12',
        residualRate: '10.00',
        location: '',
        accumulatedDepreciation: '100.00',
        netValue: '1010.00',
        saleAmount: '900.00',
        reason: '正常报废',
        salvageIncome: '10.00',
        disposalExpense: '5.00',
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

  it('only sends an explicit carrier for externally affiliated delivery vehicles', () => {
    const config = voucherEntityConfigs['sale-delivery']
    const vm = useVoucherEntityViewModel(config)
    vm.openCreate()
    const form = vm.form.value
    populate(config, form)
    form.carrier = reference('other-unit')
    form.vehicle = {
      ...reference('vehicle'),
      carrierAffiliation: {
        type: 'EXTERNAL',
        otherUnitObjectId: form.carrier.objectId,
      },
    }

    expect(
      buildVoucherDraftPayload(config, form, false, new Set()).carrier,
    ).toEqual({
      objectId: form.carrier.objectId,
      approvalEntryId: form.carrier.approvalEntryId,
    })

    form.vehicle.carrierAffiliation = {
      type: 'INTERNAL',
      operatingEntityId: 'OPERATING-ENTITY',
    }
    expect(
      buildVoucherDraftPayload(config, form, false, new Set()),
    ).not.toHaveProperty('carrier')
  })

  it('通过单据深链接标识打开现有工作区并按保存权限进入编辑态', async () => {
    const config = voucherEntityConfigs['sale-order']
    useSessionStore().permissions = [
      '/vou/sale-order/get',
      '/vou/sale-order/save',
    ]
    const vm = useVoucherEntityViewModel(config)
    populate(config, vm.form.value)
    mockedPost.mockResolvedValueOnce({
      data: documentView(config, vm.form.value),
    })

    await vm.openDocument({ documentId: 'DOCUMENT-1' }, true)

    expect(mockedPost).toHaveBeenCalledWith(
      'vou/sale-order/get',
      { documentId: 'DOCUMENT-1' },
      { signal: expect.any(AbortSignal) },
    )
    expect(vm.workspaceOpen.value).toBe(true)
    expect(vm.editing.value).toBe(true)
  })

  it('initializes a sales return draft from finalized signoff sources', async () => {
    const config = voucherEntityConfigs['sale-return']
    useSessionStore().permissions = ['/vou/sale-return/create']
    const vm = useVoucherEntityViewModel(config)
    mockedPost.mockImplementation(async (path) => {
      if (path !== 'vou/sale-signoff/get') {
        return { data: { items: [], total: 0, page: 1, pageSize: 50 } }
      }
      return {
        data: {
          data: {
            warehouse: reference('warehouse'),
            signoffLines: [
              {
                lineId: 'SIGNOFF-LINE-1',
                product: reference('product'),
                enteredQuantity: '3',
                enteredUnit: {
                  objectId: 'unit-kg',
                  code: 'UNT-0001',
                  name: '千克',
                  symbol: 'kg',
                },
                baseQuantity: '3',
                signedBaseQuantity: '3',
                rejectedBaseQuantity: '0',
                lossBaseQuantity: '0',
                returnableBaseQuantity: '2',
              },
            ],
          },
        },
      }
    })

    await vm.initializeReturnFromSources(['SIGNOFF-1'])

    expect(mockedPost).toHaveBeenCalledWith('vou/sale-signoff/get', {
      documentId: 'SIGNOFF-1',
    })
    expect(vm.workspaceOpen.value).toBe(true)
    expect(vm.form.value).toMatchObject({
      returnKind: 'AFTER_SALE',
      warehouse: { objectId: 'warehouse-object' },
      salesChainLines: [
        {
          sourceLineId: 'SIGNOFF-LINE-1',
          productCode: 'PRODUCT',
          availableBaseQuantity: '2',
          baseQuantity: '2',
        },
      ],
    })
  })

  it('defines all atomic document entities', () => {
    expect(Object.keys(voucherEntityConfigs)).toEqual([
      'sale-pricing',
      'sale-order',
      'sale-outbound',
      'sale-delivery',
      'sale-signoff',
      'sale-return',
      'order-production',
      'self-production',
      'inventory-count',
      'purchase-order',
      'purchase-inquiry',
      'purchase-inbound',
      'purchase-return',
      'sales-receipt',
      'purchase-refund',
      'other-receipt',
      'sales-refund',
      'purchase-payment',
      'other-payment',
      'employee-loan',
      'employee-repayment',
      'employee-loan-writeoff',
      'expense-reimbursement',
      'expense-payment',
      'other-income',
      'asset-acquisition',
      'asset-sale',
      'asset-liquidation',
      'bill-receipt',
      'bill-payment',
      'bill-issue',
      'bill-discount',
      'bill-maturity',
      'intermediary-calculation',
      'service-contract',
      'service-acceptance',
    ])
    expect(voucherEntityConfigs['sale-outbound'].icon).toBe('mdi-tray-arrow-up')
    expect(voucherEntityConfigs['sale-outbound'].parentEntity).toBe(
      'sale-order',
    )
    expect(voucherEntityConfigs['purchase-inbound'].parentEntity).toBe(
      'purchase-order',
    )
  })

  it('loads nonzero warehouse balances without overwriting entered counts', async () => {
    const config = voucherEntityConfigs['inventory-count']
    useSessionStore().permissions = [
      '/vou/inventory-count/create',
      '/vou/inventory-count/book-balance',
    ]
    const vm = useVoucherEntityViewModel(config)
    vm.openCreate()
    populate(config, vm.form.value)
    vm.form.value.inventoryCountLines[0]!.enteredQuantity = '3'
    vm.form.value.inventoryCountLines[0]!.baseQuantity = '3'
    vm.form.value.inventoryCountLines.push({
      key: 'manual-zero-stock',
      product: {
        ...reference('product', 'MANUAL'),
        objectId: 'manual-product-object',
        approvalEntryId: 'manual-product-version',
      },
      enteredQuantity: '1',
      enteredUnit: {
        objectId: 'unit-kg',
        code: 'UNT-0001',
        name: '千克',
        symbol: 'kg',
      },
      baseQuantity: '1',
      bookBaseQuantity: '',
      remark: '手工零库存商品',
    })
    mockedPost.mockResolvedValueOnce({
      data: {
        items: [
          {
            product: reference('product'),
            quantity: '2',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 200,
      },
    })

    await vm.loadInventoryCountBalance()

    expect(mockedPost).toHaveBeenCalledWith(
      'vou/inventory-count/book-balance',
      {
        page: 1,
        pageSize: 200,
        warehouseObjectId: 'warehouse-object',
        asOfDate: '2026-07-24',
      },
    )
    expect(vm.form.value.inventoryCountLines[0]).toMatchObject({
      enteredQuantity: '3',
      baseQuantity: '3',
      bookBaseQuantity: '2',
    })
    expect(vm.form.value.inventoryCountLines[1]).toMatchObject({
      key: 'manual-zero-stock',
      enteredQuantity: '1',
      bookBaseQuantity: '',
      remark: '手工零库存商品',
    })
  })

  it('builds entity-specific create payloads without dueDate or unrelated fields', async () => {
    for (const config of Object.values(voucherEntityConfigs).filter(
      (item) =>
        !item.parentEntity &&
        item.entity !== 'service-contract' &&
        item.entity !== 'service-acceptance',
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

      expect(
        await vm.save(),
        `${config.entity}: ${vm.workspaceError.value ?? 'unknown error'}`,
      ).toBe(true)
      const data = captured?.data as Record<string, unknown>
      expect(data).not.toHaveProperty('dueDate')
      expect(data).not.toHaveProperty('outboundDate')
      expect(data).not.toHaveProperty('inboundDate')
      expect(data).toHaveProperty(
        'businessDate',
        config.entity === 'intermediary-calculation'
          ? '2026-07-31'
          : '2026-07-24',
      )
      if (config.lineKind !== 'product')
        expect(data).not.toHaveProperty('productLines')
      if (config.lineKind !== 'expense')
        expect(data).not.toHaveProperty('expenseLines')
      if (config.lineKind !== 'price')
        expect(data).not.toHaveProperty('priceLines')
      if (!config.directAmount) expect(data).not.toHaveProperty('amount')
      if (config.lineKind === 'product') {
        const productLine = (
          data.productLines as Array<Record<string, unknown>>
        )[0]
        expect(productLine).not.toHaveProperty('purchaseUnitPrice')
        if (config.entity === 'sale-order') {
          expect(productLine.deliverySpecificationType).toBe('BULK_LIQUID')
          expect(productLine.formula).toEqual({
            output: {
              enteredQuantity: '1',
              enteredUnit: { objectId: 'unit-kg' },
              baseQuantity: '1',
            },
            sourceType: 'RAW_SELF',
            components: [
              {
                material: {
                  objectId: 'product-object',
                },
                quantity: {
                  enteredQuantity: '1',
                  enteredUnit: { objectId: 'unit-kg' },
                  baseQuantity: '1',
                },
              },
            ],
          })
        } else {
          expect(productLine).not.toHaveProperty('deliverySpecificationType')
          expect(productLine).not.toHaveProperty('formula')
        }
      }
    }
  })

  it('fills purchase reference prices and preserves manually edited prices', async () => {
    const config = voucherEntityConfigs['purchase-order']
    const vm = useVoucherEntityViewModel(config)
    vm.openCreate()
    populate(config, vm.form.value)
    mockedPost.mockResolvedValueOnce({
      data: {
        lines: [
          {
            productObjectId: 'product-object',
            unitPrice: '8.60',
            sourceDocumentId: 'INQUIRY-1',
            sourceDocumentNo: 'PIQ-20260720-0001',
            sourceBusinessDate: '2026-07-20',
          },
        ],
      },
    })

    await vm.changeLineProduct(0, vm.form.value.productLines[0]!.product)
    expect(vm.form.value.productLines[0]).toMatchObject({
      unitPrice: '8.60',
      referenceUnitPrice: '8.60',
      referenceDocumentNo: 'PIQ-20260720-0001',
      priceDirty: false,
    })

    vm.form.value.productLines[0]!.unitPrice = '9.10'
    vm.form.value.productLines[0]!.priceDirty = true
    mockedPost.mockResolvedValueOnce({
      data: {
        lines: [{ productObjectId: 'product-object', unitPrice: '8.80' }],
      },
    })
    vm.markReferenceChanged('supplier')
    await vi.waitFor(() => {
      expect(vm.form.value.productLines[0]).toMatchObject({
        unitPrice: '9.10',
        referenceUnitPrice: '8.80',
        priceDirty: true,
      })
    })
  })

  it('builds manual and automatic sales return payloads', () => {
    const config = voucherEntityConfigs['sale-return']
    const form = useVoucherEntityViewModel(config).form.value
    form.businessDate = '2026-07-29'
    form.warehouse = reference('warehouse')
    form.returnReason = '客户售后退货'
    form.returnKind = 'AFTER_SALE'
    form.salesChainLines = [
      {
        key: 'RETURN-1',
        sourceLineId: 'SIGNOFF-LINE-1',
        productCode: 'P-1',
        productName: '产品一',
        enteredUnitSymbol: '件',
        availableBaseQuantity: '3',
        outboundBaseQuantity: '',
        baseQuantity: '2',
        signedBaseQuantity: '',
        rejectedBaseQuantity: '',
        lossBaseQuantity: '',
        remark: '包装完整',
      },
      {
        key: 'RETURN-2',
        sourceLineId: 'SIGNOFF-LINE-2',
        productCode: 'P-2',
        productName: '产品二',
        enteredUnitSymbol: '件',
        availableBaseQuantity: '1',
        outboundBaseQuantity: '',
        baseQuantity: '1',
        signedBaseQuantity: '',
        rejectedBaseQuantity: '',
        lossBaseQuantity: '',
        remark: '',
      },
    ]

    expect(buildVoucherDraftPayload(config, form, false, new Set())).toEqual({
      businessDate: '2026-07-29',
      currency: 'CNY',
      warehouse: {
        objectId: 'warehouse-object',
        approvalEntryId: 'warehouse-version',
      },
      returnReason: '客户售后退货',
      returnLines: [
        {
          sourceLineId: 'SIGNOFF-LINE-1',
          baseQuantity: '2',
          remark: '包装完整',
        },
        {
          sourceLineId: 'SIGNOFF-LINE-2',
          baseQuantity: '1',
        },
      ],
    })

    form.returnKind = 'REFUSAL'
    form.returnReason = '客户拒收'
    expect(
      buildVoucherDraftPayload(config, form, true, new Set()),
    ).not.toHaveProperty('returnLines')
  })

  it('loads an approved order and creates an outbound batch with source lines', async () => {
    const config = voucherEntityConfigs['sale-outbound']
    const orderConfig = voucherEntityConfigs['sale-order']
    const orderForm = useVoucherEntityViewModel(orderConfig).form.value
    populate(orderConfig, orderForm)
    const order = documentView(orderConfig, orderForm)
    order.documentId = 'ORDER-1'
    order.documentNo = 'SOR-20260724-0001'
    order.status = 'APPROVED'
    order.data.productLines![0].availableBaseQuantity = '6.0'

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
            documentNo: 'SOB-20260724-0001',
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
    await vm.searchSourceDocuments('SOR-20260724')
    await vm.selectSourceDocument(order.documentId)
    expect(vm.form.value.salesChainLines).toHaveLength(1)
    expect(vm.form.value.salesChainLines[0]).toMatchObject({
      sourceLineId: 'LINE-0',
      availableBaseQuantity: '6.0',
      baseQuantity: '6.0',
    })

    vm.form.value.businessDate = '2026-07-25'
    vm.form.value.warehouse = reference('warehouse')
    vm.form.value.salesChainLines[0].baseQuantity = '4'
    expect(await vm.save()).toBe(true)
    expect(captured).toEqual({
      parentEntity: 'sale-order',
      parentDocumentId: 'ORDER-1',
      data: {
        businessDate: '2026-07-25',
        currency: 'CNY',
        warehouse: {
          objectId: 'warehouse-object',
          approvalEntryId: 'warehouse-version',
        },
        sourceLines: [
          {
            sourceLineId: 'LINE-0',
            baseQuantity: '4',
          },
        ],
      },
    })
  })

  it('uses exact VOU write permissions for atomic documents', async () => {
    const config = voucherEntityConfigs['sale-order']
    useSessionStore().permissions = [
      '/vou/sale-order/query',
      '/vou/sale-order/get',
      '/vou/sale-order/create',
      '/vou/sale-order/save',
      '/vou/sale-order/submit',
      '/vou/sale-order/attachment-initiate',
      '/vou/sale-order/attachment-remove',
    ]
    const vm = useVoucherEntityViewModel(config)
    mockedPost.mockResolvedValue({
      data: documentView(config, vm.form.value),
    })
    await vm.openDocument({
      documentId: 'DOCUMENT-1',
      entity: config.entity,
      documentNo: 'SO-1',
      status: 'DRAFT',
      revision: 1,
      businessDate: '2026-07-24',
      currency: 'CNY',
      amount: '10.00',
      updatedAt: '2026-07-24T00:00:00Z',
    })
    expect(vm.canCreate.value).toBe(true)
    expect(
      vm.canEdit({
        documentId: 'DOCUMENT-1',
        entity: config.entity,
        documentNo: 'SO-1',
        status: 'DRAFT',
        revision: 1,
        businessDate: '2026-07-24',
        currency: 'CNY',
        amount: '10.00',
        updatedAt: '2026-07-24T00:00:00Z',
      }),
    ).toBe(true)
    expect(vm.actionAvailability.value.save).toBe(true)
    expect(vm.actionAvailability.value.submit).toBe(true)
    expect(vm.actionAvailability.value.attachmentInitiate).toBe(true)
    expect(vm.actionAvailability.value.attachmentRemove).toBe(true)
  })

  it('preloads customer references when opening sale-order create', async () => {
    const config = voucherEntityConfigs['sale-order']
    mockedPost.mockResolvedValue({
      data: [
        {
          objectId: 'customer-a',
          approvalEntryId: 'customer-ver',
          code: 'CUS-001',
          name: '客户 A',
        },
      ],
    } as never)
    useSessionStore().permissions = [
      '/vou/sale-order/create',
      '/bob/reference/query',
    ]

    const vm = useVoucherEntityViewModel(config)
    expect(vm.canCreate.value).toBe(true)
    vm.openCreate()
    await vi.waitFor(() =>
      expect(vm.referenceOptions('customer')).toHaveLength(1),
    )

    expect(mockedPost).toHaveBeenCalledWith(
      'bob/reference/query',
      { entity: 'customer-account' },
      expect.any(Object),
    )
    expect(vm.referenceOptions('customer')).toEqual([
      expect.objectContaining({
        objectId: 'customer-a',
        entity: 'customer-account',
        code: 'CUS-001',
      }),
    ])
    expect(vm.referenceError('customer')).toBeNull()
  })

  it('preloads supplier references when opening purchase-order and asset-acquisition create', async () => {
    const cases = ['purchase-order', 'asset-acquisition'] as const
    mockedPost.mockResolvedValue({
      data: [
        {
          objectId: 'supplier-a',
          approvalEntryId: 'supplier-ver',
          code: 'SUP-001',
          name: '供应商 A',
        },
      ],
    } as never)

    for (const entity of cases) {
      const config = voucherEntityConfigs[entity]
      useSessionStore().permissions = [
        `/vou/${entity}/create`,
        '/bob/supplier/query',
      ]
      mockedPost.mockClear()

      const vm = useVoucherEntityViewModel(config)
      vm.openCreate()
      await vi.waitFor(() =>
        expect(vm.referenceOptions('supplier')).toHaveLength(1),
      )

      expect(mockedPost).toHaveBeenCalledWith(
        'bob/reference/query',
        { entity: 'supplier' },
        expect.any(Object),
      )
      expect(vm.referenceOptions('supplier')).toEqual([
        expect.objectContaining({
          objectId: 'supplier-a',
          entity: 'supplier',
          code: 'SUP-001',
        }),
      ])
    }
  })

  it('preloads employee counterparties when opening employee-loan create', async () => {
    const config = voucherEntityConfigs['employee-loan']
    mockedPost.mockResolvedValue({
      data: [
        {
          objectId: 'employee-a',
          approvalEntryId: 'employee-ver',
          code: 'EMP-001',
          name: '员工 A',
        },
      ],
    } as never)
    useSessionStore().permissions = [
      '/vou/employee-loan/create',
      '/bob/employee/query',
    ]

    const vm = useVoucherEntityViewModel(config)
    vm.openCreate()
    await vi.waitFor(() =>
      expect(vm.referenceOptions('counterparty')).toHaveLength(1),
    )

    expect(mockedPost).toHaveBeenCalledWith(
      'bob/reference/query',
      { entity: 'employee' },
      expect.any(Object),
    )
    expect(vm.referenceOptions('counterparty')).toEqual([
      expect.objectContaining({
        objectId: 'employee-a',
        entity: 'employee',
        code: 'EMP-001',
      }),
    ])
    expect(vm.referenceError('counterparty')).toBeNull()
  })

  it('keeps legal empty required references as empty without error on create', async () => {
    const config = voucherEntityConfigs['sale-order']
    mockedPost.mockResolvedValue({ data: [] } as never)
    useSessionStore().permissions = [
      '/vou/sale-order/create',
      '/bob/reference/query',
    ]

    const vm = useVoucherEntityViewModel(config)
    vm.openCreate()
    await vi.waitFor(() =>
      expect(vm.referenceOptions('customer')).toHaveLength(0),
    )

    expect(mockedPost).toHaveBeenCalledWith(
      'bob/reference/query',
      { entity: 'customer-account' },
      expect.any(Object),
    )
    expect(vm.referenceOptions('customer')).toEqual([])
    expect(vm.referenceError('customer')).toBeNull()
  })

  it('only exposes matching effective BOB object and version pairs', async () => {
    vi.useFakeTimers()
    useSessionStore().permissions = ['/bob/customer/query']
    const vm = useVoucherEntityViewModel(voucherEntityConfigs['sales-receipt'])
    mockedPost.mockResolvedValue({
      data: {
        items: [
          {
            objectId: 'VALID',
            sourceApprovalEntryId: 'VER-1',
            code: 'CUS-1',
            displayName: '有效客户',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })

    vm.searchReference('customer', 'CUS')
    await vi.advanceTimersByTimeAsync(250)

    expect(mockedPost).toHaveBeenCalledWith(
      'bob/customer/query',
      {
        page: 1,
        pageSize: 20,
        filters: { keyword: 'CUS' },
        sort: [{ field: 'code', order: 'asc' }],
      },
      expect.any(Object),
    )

    expect(vm.referenceOptions('customer')).toEqual([
      {
        objectId: 'VALID',
        approvalEntryId: 'VER-1',
        entity: 'customer',
        code: 'CUS-1',
        name: '有效客户',
      },
    ])
    vi.useRealTimers()
  })

  it('loads service and sales relationships through the typed reference contract', async () => {
    vi.useFakeTimers()
    useSessionStore().permissions = [
      '/bob/other-unit/query',
      '/bob/sales-partner/query',
    ]
    const vm = useVoucherEntityViewModel(
      voucherEntityConfigs['service-contract'],
    )
    mockedPost.mockImplementation(async (_path, body) => {
      const input = body as { entity: string }
      return {
        data: [
          {
            objectId: `${input.entity}-object`,
            approvalEntryId: `${input.entity}-version`,
            code: input.entity === 'other-unit' ? 'OTU-1' : 'SLP-1',
            name: input.entity === 'other-unit' ? '服务单位' : '销售合作方',
          },
        ],
      }
    })

    vm.form.value.counterpartyType = 'other-unit'
    vm.searchReference('counterparty', 'OTU')
    await vi.advanceTimersByTimeAsync(250)
    expect(mockedPost).toHaveBeenLastCalledWith(
      'bob/reference/query',
      { entity: 'other-unit', keyword: 'OTU' },
      expect.any(Object),
    )
    expect(vm.referenceOptions('counterparty')).toMatchObject([
      { entity: 'other-unit', code: 'OTU-1' },
    ])

    vm.form.value.counterpartyType = 'sales-partner'
    vm.searchReference('counterparty', 'SLP')
    await vi.advanceTimersByTimeAsync(250)
    expect(mockedPost).toHaveBeenLastCalledWith(
      'bob/reference/query',
      { entity: 'sales-partner', keyword: 'SLP' },
      expect.any(Object),
    )
    expect(vm.referenceOptions('counterparty')).toMatchObject([
      { entity: 'sales-partner', code: 'SLP-1' },
    ])
    vi.useRealTimers()
  })

  it('omits empty optional sales-contract fields from a service relationship contract', async () => {
    const config = voucherEntityConfigs['service-contract']
    useSessionStore().permissions = ['/vou/service-contract/create']
    const vm = useVoucherEntityViewModel(config)
    vm.openCreate()
    vm.form.value.counterpartyType = 'other-unit'
    vm.form.value.counterparty = reference('other-unit')
    vm.form.value.handler = reference('employee')
    vm.form.value.serviceContract.terms = '服务条款'
    let captured: { data?: Record<string, unknown> } | undefined
    mockedPost.mockImplementation(async (path, body) => {
      if (path.endsWith('/create')) {
        captured = body as { data?: Record<string, unknown> }
        return {
          data: {
            documentId: 'CONTRACT-1',
            documentNo: 'SCT-0001',
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
    expect(captured?.data?.serviceContract).toEqual({ terms: '服务条款' })
  })

  it('loads typed delivery vehicles and filters the external carrier to the selected affiliation', async () => {
    vi.useFakeTimers()
    useSessionStore().permissions = [
      '/bob/vehicle/query',
      '/bob/other-unit/query',
    ]
    const vm = useVoucherEntityViewModel(voucherEntityConfigs['sale-delivery'])
    const requests: Array<Record<string, unknown>> = []
    mockedPost.mockImplementation(async (path, body) => {
      requests.push(body as Record<string, unknown>)
      if (
        path === 'bob/reference/query' &&
        (body as { entity?: string }).entity === 'other-unit'
      ) {
        return {
          data: [
            {
              objectId: 'CARRIER',
              code: 'CAR-1',
              approvalEntryId: 'CAR-VER',
              name: '外部承运方',
            },
            {
              objectId: 'OTHER-CARRIER',
              code: 'CAR-2',
              approvalEntryId: 'OTHER-VER',
              name: '其它承运方',
            },
          ],
        }
      }
      return {
        data: {
          items: [
            {
              objectId: 'MATCHING',
              code: 'VEH-1',
              sourceApprovalEntryId: 'VER-1',
              sourceVersionNo: 1,
              data: {
                name: '匹配车辆',
                carrierAffiliation: {
                  type: 'EXTERNAL',
                  otherUnitObjectId: 'CARRIER',
                },
                bulkLiquidCapable: true,
              },
            },
            {
              objectId: 'OTHER',
              code: 'VEH-2',
              sourceApprovalEntryId: 'VER-2',
              sourceVersionNo: 1,
              data: {
                name: '其它车辆',
                carrierAffiliation: {
                  type: 'INTERNAL',
                  operatingEntityId: 'OPERATING',
                },
                bulkLiquidCapable: false,
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

    expect(vm.referenceOptions('vehicle')).toHaveLength(2)
    vm.form.value.vehicle = vm.referenceOptions('vehicle')[0]!
    vm.markReferenceChanged('vehicle')
    vm.searchReference('carrier', '承运')
    await vi.advanceTimersByTimeAsync(250)
    expect(vm.referenceOptions('carrier').map((item) => item.objectId)).toEqual(
      ['CARRIER'],
    )
    vi.useRealTimers()
  })

  it('derives lifecycle actions from exact status and permission paths', async () => {
    const config = voucherEntityConfigs['purchase-payment']
    const view = documentView(config, {
      ...useVoucherEntityViewModel(config).form.value,
      counterpartyType: 'customer',
      counterparty: reference('customer'),
      fundAccount: reference('fund-account'),
      handler: reference('employee'),
      currency: 'CNY',
      amount: '10.00',
    })
    view.approval.status = 'PENDING'
    view.availableApprovalActions = ['unsubmit', 'approve']
    useSessionStore().permissions = [
      '/vou/purchase-payment/get',
      '/vou/purchase-payment/approve',
      '/vou/purchase-payment/unsubmit',
    ]
    mockedPost.mockResolvedValue({ data: view })
    const vm = useVoucherEntityViewModel(config)

    await vm.openDocument({
      documentId: view.documentId,
      entity: config.entity,
      documentNo: view.documentNo,
      status: 'PENDING',
      revision: 1,
      businessDate: '2026-07-24',
      currency: 'CNY',
      amount: '10.00',
      updatedAt: '2026-07-24T00:00:00Z',
    })

    expect(vm.actionAvailability.value).toMatchObject({
      approve: true,
      unsubmit: true,
      submit: false,
      unapprove: false,
    })
  })

  it('hydrates the employee counterparty type from an existing loan', () => {
    const config = voucherEntityConfigs['employee-loan']
    const currentForm = useVoucherEntityViewModel(config).form.value
    populate(config, currentForm)

    expect(formFromDocument(documentView(config, currentForm))).toMatchObject({
      counterpartyType: 'employee',
      counterparty: { entity: 'employee' },
    })
  })

  it('hydrates sales receipt customer, operating entity, and allocations', () => {
    const config = voucherEntityConfigs['sales-receipt']
    const currentForm = useVoucherEntityViewModel(config).form.value
    populate(config, currentForm)
    expect(formFromDocument(documentView(config, currentForm))).toMatchObject({
      customer: { entity: 'customer' },
      operatingEntity: { entity: 'operating-entity' },
      accountAllocations: [
        {
          account: {
            entity: 'customer-account',
            customerId: 'customer-object',
          },
          amount: '10.00',
        },
      ],
    })
  })

  it('builds a sales receipt payload without a counterparty fallback', () => {
    const config = voucherEntityConfigs['sales-receipt']
    const form = useVoucherEntityViewModel(config).form.value
    populate(config, form)

    expect(
      buildVoucherDraftPayload(config, form, false, new Set()),
    ).toMatchObject({
      customer: {
        objectId: 'customer-object',
        approvalEntryId: 'customer-version',
      },
      operatingEntity: {
        objectId: 'operating-entity-object',
        approvalEntryId: 'operating-entity-version',
      },
      accountAllocations: [
        {
          account: {
            objectId: 'customer-account-object',
            approvalEntryId: 'customer-account-version',
          },
          amount: '10.00',
        },
      ],
    })
    expect(
      buildVoucherDraftPayload(config, form, false, new Set()),
    ).not.toHaveProperty('counterparty')
  })

  it('rejects service acceptance payloads without a settlement direction', () => {
    const config = voucherEntityConfigs['service-acceptance']
    const form = useVoucherEntityViewModel(config).form.value
    form.serviceAcceptance.settlementDirection = ''

    expect(() => buildVoucherDraftPayload(config, form)).toThrow(
      '请选择结算方向。',
    )
  })

  it('executes permitted lifecycle actions directly from list rows', async () => {
    const config = voucherEntityConfigs['sale-order']
    useSessionStore().permissions = [
      '/vou/sale-order/query',
      '/vou/sale-order/get',
      '/vou/sale-order/save',
      '/vou/sale-order/submit',
      '/vou/sale-order/approve',
    ]
    const row = {
      documentId: 'DOCUMENT-1',
      entity: config.entity,
      documentNo: 'SO-1',
      status: 'DRAFT' as const,
      revision: 3,
      availableApprovalActions: ['submit'],
      businessDate: '2026-07-31',
      currency: 'CNY',
      amount: '10.00',
      updatedAt: '2026-07-31T00:00:00Z',
    }
    mockedPost.mockImplementation(async (path) => {
      if (path.endsWith('/query')) {
        return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
      }
      return {
        data: {
          documentId: row.documentId,
          documentNo: row.documentNo,
          approval: {
            ...documentView(config, vm.form.value).approval,
            status: 'PENDING',
            revision: 4,
          },
        },
      }
    })
    const vm = useVoucherEntityViewModel(config)

    expect(await vm.lifecycleActionFromList(row, 'approve')).toBe(false)
    expect(await vm.lifecycleActionFromList(row, 'submit')).toBe(true)
    expect(mockedPost).toHaveBeenCalledWith('vou/sale-order/submit', {
      documentId: 'DOCUMENT-1',
      revision: 3,
    })
    expect(mockedPost).toHaveBeenCalledWith(
      'vou/sale-order/query',
      expect.objectContaining({
        sort: [{ field: 'documentNo', order: 'desc' }],
      }),
      expect.any(Object),
    )
    expect(vm.successMessage.value).toBe('SO-1 已提交。')
    expect(vm.actionLoading.value).toBeNull()
  })

  it('rejects a workspace lifecycle action absent from the detail snapshot without replay', async () => {
    const config = voucherEntityConfigs['sale-order']
    useSessionStore().permissions = [
      '/vou/sale-order/query',
      '/vou/sale-order/get',
      '/vou/sale-order/approve',
    ]
    const view = documentView(
      config,
      useVoucherEntityViewModel(config).form.value,
    )
    view.availableApprovalActions = ['submit']
    mockedPost.mockResolvedValue({ data: view })
    const vm = useVoucherEntityViewModel(config)
    await vm.openDocument({
      documentId: view.documentId,
      entity: config.entity,
      documentNo: view.documentNo,
      status: 'DRAFT',
      revision: 1,
      businessDate: '2026-07-24',
      currency: 'CNY',
      amount: '10.00',
      updatedAt: '2026-07-24T00:00:00Z',
    })
    mockedPost.mockClear()

    await expect(vm.lifecycleAction('approve')).resolves.toBe(false)

    expect(mockedPost).not.toHaveBeenCalled()
    expect(vm.actionLoading.value).toBeNull()
  })

  it('refreshes the detail, list, and audit after one stale lifecycle request without replay', async () => {
    const config = voucherEntityConfigs['sale-order']
    useSessionStore().permissions = [
      '/vou/sale-order/query',
      '/vou/sale-order/get',
      '/vou/sale-order/submit',
      '/vou/sale-order/audit-history',
    ]
    const view = documentView(
      config,
      useVoucherEntityViewModel(config).form.value,
    )
    const refreshedView: VoucherDocumentView = {
      ...view,
      availableApprovalActions: ['unsubmit'],
      approval: {
        ...view.approval,
        status: 'PENDING',
        revision: view.approval.revision + 1,
      },
    }
    let getCount = 0
    mockedPost.mockImplementation(async (path) => {
      if (path === 'vou/sale-order/submit') {
        throw new ApiError('business', 'stale', {
          errorKey: 'approval_stale_revision',
        })
      }
      if (path === 'vou/sale-order/get') {
        getCount += 1
        return { data: getCount === 1 ? view : refreshedView }
      }
      if (path === 'vou/sale-order/query') {
        return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
      }
      if (path === 'vou/sale-order/audit-history') {
        return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
      }
      throw new Error(`unexpected request: ${path}`)
    })
    const vm = useVoucherEntityViewModel(config)
    await vm.openDocument({
      documentId: view.documentId,
      entity: config.entity,
      documentNo: view.documentNo,
      status: 'DRAFT',
      revision: view.approval.revision,
      businessDate: view.data.businessDate,
      currency: view.data.currency,
      amount: view.amount,
      updatedAt: view.approval.updatedAt,
    })

    await expect(vm.lifecycleAction('submit')).resolves.toBe(false)

    expect(
      mockedPost.mock.calls.filter(
        ([path]) => path === 'vou/sale-order/submit',
      ),
    ).toHaveLength(1)
    expect(getCount).toBe(2)
    expect(mockedPost).toHaveBeenCalledWith(
      'vou/sale-order/query',
      expect.any(Object),
      expect.any(Object),
    )
    expect(mockedPost).toHaveBeenCalledWith('vou/sale-order/audit-history', {
      documentId: view.documentId,
      page: 1,
      pageSize: 20,
    })
    expect(vm.documentView.value).toMatchObject({
      availableApprovalActions: ['unsubmit'],
      approval: { status: 'PENDING', revision: 2 },
    })
    expect(vm.workspaceError.value).toContain('当前版本已被其他操作修改')
  })

  it('keeps list and workspace navigation behavior stable', async () => {
    const config = voucherEntityConfigs['sales-receipt']
    useSessionStore().permissions = [
      '/vou/sales-receipt/query',
      '/vou/sales-receipt/get',
      '/vou/sales-receipt/save',
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
    expect(vm.sort.value).toEqual({ field: 'documentNo', order: 'desc' })

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
