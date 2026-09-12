import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs as stubs } from './helpers/archive-stubs.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  getTargetIntermediaryScript: vi.fn(),
  saveTargetIntermediaryScript: vi.fn(),
  getTargetIntermediarySource: vi.fn(),
  queryTargetVouchers: vi.fn(),
  queryTargetVouOptions: vi.fn(),
  resolveTargetProduct: vi.fn(),
  queryTargetBobOptions: vi.fn(),
  queryTargetCustomerLatestLine: vi.fn(),
  resolveTargetSaleOrderLine: vi.fn(),
  resolveTargetCustomerSubunit: vi.fn(),
  resolveTargetSupplier: vi.fn(),
  getTargetVoucher: vi.fn(),
  queryTargetOpenings: vi.fn(),
  queryTargetBookOptions: vi.fn(),
  queryTargetSubjectOptions: vi.fn(),
  submitTargetOpening: vi.fn(),
  submitTargetOrder: vi.fn(),
  submitTargetVoucher: vi.fn(),
  queryTargetVouSourceLines: vi.fn(),
  queryTargetInventoryBookBalance: vi.fn(),
}))
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.user = { id: 'maintainer', code: 'maintainer', name: '制单人' }
  session.csrfToken = 'test-csrf'
})
async function click(wrapper: VueWrapper, caption: string) {
  if (caption === '查询') {
    await wrapper.get('form.dynamic-form').trigger('submit')
    await flushPromises()
    return
  }
  const button = wrapper
    .findAll('button')
    .find((item) => item.text() === caption)
  expect(button, `button ${caption}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
it.each(['sale-order', 'purchase-order'])(
  'opens and cancels %s Draft through its resource without query permission',
  async (entity) => {
    useTargetSession().apiPaths = [`/vou/${entity}/submit-new`]
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    expect(wrapper.find('[aria-label="业务日期"]').exists()).toBe(true)
    await click(wrapper, '取消')
    expect(wrapper.find('[aria-label="业务日期"]').exists()).toBe(false)
    expect(api.queryTargetVouchers).not.toHaveBeenCalled()
    expect(api.queryTargetVouOptions).toHaveBeenCalled()
    wrapper.unmount()
  },
)
it('submits a purchase order from selected candidates and confirmed quantities, then refreshes once', async () => {
  useTargetSession().apiPaths = [
    '/vou/purchase-order/submit-new',
    '/bob/product/get',
    '/vou/purchase-order/query',
  ]
  vi.mocked(api.queryTargetVouchers).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.queryTargetVouOptions).mockImplementation(
    async (entity) =>
      ({
        items: [
          {
            entity: entity,
            objectId: entity === 'product' ? productId : referenceId,
            code: '01',
            name: entity === 'product' ? '包装桶' : '候选资料',
            approvalEntryId: entryId,
          },
        ],
      }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
  )
  vi.mocked(api.resolveTargetProduct).mockResolvedValue(
    productCurrent as Awaited<ReturnType<typeof api.resolveTargetProduct>>,
  )
  vi.mocked(api.submitTargetOrder).mockResolvedValue({
    documentId: referenceId,
  } as Awaited<ReturnType<typeof api.submitTargetOrder>>)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'purchase-order' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新建')
  await wrapper
    .get('[data-testid="document-editor"] [aria-label="供应商"]')
    .setValue(referenceId)
  await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
  await click(wrapper, '添加商品行')
  await wrapper.get('[aria-label="产品"]').setValue(productId)
  await flushPromises()
  await wrapper.get('[aria-label="录入数量"]').setValue('2')
  await wrapper.get('[aria-label="基准数量"]').setValue('2')
  await wrapper.get('[aria-label="基础单价"]').setValue('15.00')
  await click(wrapper, '提交')
  expect(api.submitTargetOrder, wrapper.text()).toHaveBeenCalledTimes(1)
  const [, entity, input] = vi.mocked(api.submitTargetOrder).mock.calls[0]!
  expect(entity).toBe('purchase-order')
  expect(input.payload).toMatchObject({
    supplier: {
      objectId: referenceId,
      approvalEntryId: entryId,
      selectionOrigin: 'CURRENT',
    },
    warehouse: { objectId: referenceId },
    productLines: [
      {
        product: { objectId: productId },
        enteredQuantity: '2',
        baseQuantity: '2',
        unitPrice: '15.00',
        enteredUnit: { objectId: unitId, quantityScale: 0 },
      },
    ],
  })
  expect(input.documentId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  expect(input.submissionId).not.toBe(input.documentId)
  expect(input.idempotencyKey).toBe(input.submissionId)
  expect(api.queryTargetVouchers).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('提交成功')
  wrapper.unmount()
})
const referenceId = '01K00000000000000000000001',
  entryId = '01K00000000000000000000002',
  productId = '01K00000000000000000000003',
  unitId = '01K00000000000000000000004'
const unit = {
  id: unitId,
  code: 'PC',
  name: '个',
  symbol: '个',
  quantityScale: 0,
}
const productCurrent = {
  objectId: productId,
  code: 'P01',
  name: '包装桶',
  sourceApprovalEntryId: entryId,
  enabled: true,
  data: {
    name: '包装桶',
    productType: {
      id: referenceId,
      code: 'PKG',
      name: '包装物',
      behaviorProfile: 'PACKAGING',
    },
    pricingUnit: unit,
    defaultInputUnit: unit,
    unitConversions: [{ unit, factor: '1' }],
    defaultPackagingSpec: '',
    fixedFormula: null,
  },
}
it('adopts customer defaults, keeps the internal reminder out of the order, and fixes a raw-material self formula', async () => {
  useTargetSession().apiPaths = [
    '/vou/sale-order/submit-new',
    '/bob/customer/get',
    '/bob/product/get',
  ]
  vi.mocked(api.queryTargetVouOptions).mockImplementation(
    async (entity) =>
      ({
        items: [
          {
            entity: entity,
            objectId: entity === 'product' ? productId : referenceId,
            approvalEntryId: entryId,
            code: '01',
            name: '候选资料',
            ...(entity === 'customer-subunit'
              ? { customerId: referenceId, paymentMethod: null }
              : {}),
          },
        ],
      }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
  )
  vi.mocked(api.resolveTargetCustomerSubunit).mockResolvedValue({
    objectId: referenceId,
    sourceApprovalEntryId: entryId,
    enabled: true,
    data: {
      subunits: [
        {
          id: referenceId,
          enabled: true,
          defaultSalesOrderRemark: '送货前联系',
          internalReminder: '内部信用提醒',
          settlementMethod: null,
        },
      ],
    },
  } as Awaited<ReturnType<typeof api.resolveTargetCustomerSubunit>>)
  vi.mocked(api.resolveTargetProduct).mockResolvedValue({
    ...productCurrent,
    data: {
      ...productCurrent.data,
      productType: {
        ...productCurrent.data.productType,
        behaviorProfile: 'RAW_MATERIAL',
      },
      defaultPackagingSpec: '25',
    },
  } as Awaited<ReturnType<typeof api.resolveTargetProduct>>)
  vi.mocked(api.submitTargetOrder).mockResolvedValue({
    documentId: referenceId,
  } as Awaited<ReturnType<typeof api.submitTargetOrder>>)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'sale-order' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  await wrapper
    .get('[data-testid="document-editor"] [aria-label="客户子单位"]')
    .setValue(referenceId)
  await flushPromises()
  expect(wrapper.text()).toContain('内部信用提醒')
  expect(
    (wrapper.get('[aria-label="备注"]').element as HTMLInputElement).value,
  ).toBe('送货前联系')
  await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
  await wrapper.get('[aria-label="经营主体"]').setValue(referenceId)
  await click(wrapper, '添加商品行')
  await wrapper.get('[aria-label="产品"]').setValue(productId)
  await flushPromises()
  await wrapper.get('[aria-label="录入数量"]').setValue('2')
  await wrapper.get('[aria-label="基准数量"]').setValue('2')
  await wrapper.get('[aria-label="基础单价"]').setValue('10.00')
  await click(wrapper, '提交')
  expect(api.submitTargetOrder, wrapper.text()).toHaveBeenCalledTimes(1)
  const payload = vi.mocked(api.submitTargetOrder).mock.calls[0]![2].payload
  expect(payload).toMatchObject({
    remark: '送货前联系',
    productLines: [
      {
        formula: {
          sourceType: 'RAW_SELF',
          output: { baseQuantity: '1' },
          components: [
            {
              material: { objectId: productId },
              quantity: { baseQuantity: '1' },
            },
          ],
        },
      },
    ],
  })
  expect(JSON.stringify(payload)).not.toContain('内部信用提醒')
  wrapper.unmount()
})
it('keeps an uncertain order submission locked across closing, querying and reopening, and verifies the original identity', async () => {
  useTargetSession().apiPaths = [
    '/vou/purchase-order/submit-new',
    '/vou/purchase-order/get',
    '/vou/purchase-order/query',
    '/bob/product/get',
  ]
  vi.mocked(api.queryTargetVouchers).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.queryTargetVouOptions).mockImplementation(
    async (entity) =>
      ({
        items: [
          {
            entity: entity,
            objectId: entity === 'product' ? productId : referenceId,
            approvalEntryId: entryId,
            code: '01',
            name: '候选',
          },
        ],
      }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
  )
  vi.mocked(api.resolveTargetProduct).mockResolvedValue(
    productCurrent as Awaited<ReturnType<typeof api.resolveTargetProduct>>,
  )
  vi.mocked(api.submitTargetOrder).mockRejectedValue(
    new TypeError('lost response'),
  )
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'purchase-order' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  await wrapper
    .get('[data-testid="document-editor"] [aria-label="供应商"]')
    .setValue(referenceId)
  await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
  await click(wrapper, '添加商品行')
  await wrapper.get('[aria-label="产品"]').setValue(productId)
  await flushPromises()
  await wrapper.get('[aria-label="录入数量"]').setValue('1')
  await wrapper.get('[aria-label="基准数量"]').setValue('1')
  await wrapper.get('[aria-label="基础单价"]').setValue('1')
  await click(wrapper, '提交')
  expect(wrapper.text()).toContain('未知')
  await click(wrapper, '取消')
  await click(wrapper, '查询')
  await click(wrapper, '新建')
  expect(wrapper.find('[data-testid="document-editor"]').exists()).toBe(false)
  const original = vi.mocked(api.submitTargetOrder).mock.calls[0]![2]
  vi.mocked(api.getTargetVoucher).mockResolvedValue({
    entity: 'purchase-order',
    documentId: original.documentId,
    submissionId: original.submissionId,
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>)
  await click(wrapper, '核实原提交')
  expect(api.getTargetVoucher).toHaveBeenCalledWith(
    'test-csrf',
    'purchase-order',
    original.documentId,
  )
  expect(api.submitTargetOrder).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('已核实提交成功')
  wrapper.unmount()
})
it('offers the shared attachment input only with exact order staging permission', async () => {
  useTargetSession().apiPaths = [
    '/vou/purchase-order/submit-new',
    '/vou/purchase-order/attachment-stage',
  ]
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'purchase-order' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  expect(wrapper.find('[aria-label="添加附件"]').exists()).toBe(true)
  wrapper.unmount()
})
it('submits opening with its independent payload and keeps its unknown result locked after closing', async () => {
  useTargetSession().apiPaths = [
    '/vou/opening/submit-new',
    '/acc/book/query',
    '/acc/subject/query',
  ]
  vi.mocked(api.queryTargetBookOptions).mockResolvedValue({
    items: [
      { id: referenceId, code: 'B01', name: '账簿', baseCurrency: 'CNY' },
    ],
    total: 1,
  } as Awaited<ReturnType<typeof api.queryTargetBookOptions>>)
  vi.mocked(api.queryTargetSubjectOptions).mockResolvedValue({
    items: [],
    total: 0,
  } as Awaited<ReturnType<typeof api.queryTargetSubjectOptions>>)
  vi.mocked(api.submitTargetOpening).mockRejectedValue(new TypeError('unknown'))
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'opening' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  await wrapper.get('[aria-label="账簿"]').setValue(referenceId)
  await flushPromises()
  await click(wrapper, '提交零期初')
  expect(api.submitTargetOpening).toHaveBeenCalledWith(
    'test-csrf',
    expect.objectContaining({
      bookId: referenceId,
      lines: [],
      assets: [],
      bills: [],
      containers: [],
    }),
  )
  expect(
    vi.mocked(api.submitTargetOpening).mock.calls[0]![1],
  ).not.toHaveProperty('payload')
  await click(wrapper, '取消')
  await click(wrapper, '新建')
  expect(wrapper.find('[aria-label="账簿"]').exists()).toBe(false)
  expect(api.submitTargetOpening).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
it('keeps a failed opening input and intent, then discards both when starting another Draft', async () => {
  useTargetSession().apiPaths = [
    '/vou/opening/submit-new',
    '/acc/book/query',
    '/acc/subject/query',
  ]
  vi.mocked(api.queryTargetBookOptions).mockResolvedValue({
    items: [
      { id: referenceId, code: 'B01', name: '账簿', baseCurrency: 'CNY' },
    ],
    total: 1,
  } as Awaited<ReturnType<typeof api.queryTargetBookOptions>>)
  vi.mocked(api.queryTargetSubjectOptions).mockResolvedValue({
    items: [],
    total: 0,
  } as Awaited<ReturnType<typeof api.queryTargetSubjectOptions>>)
  vi.mocked(api.submitTargetOpening).mockRejectedValue(
    new api.TargetApiError('acc_opening_unbalanced', '', 'req'),
  )
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'opening' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  await wrapper.get('[aria-label="账簿"]').setValue(referenceId)
  await flushPromises()
  await click(wrapper, '添加明细')
  await wrapper.get('[aria-label="金额"]').setValue('12.30')
  await click(wrapper, '提交期初')
  expect(wrapper.text()).toContain('逐币种')
  expect(
    (wrapper.get('[aria-label="金额"]').element as HTMLInputElement).value,
  ).toBe('12.30')
  await click(wrapper, '提交期初')
  expect(
    vi.mocked(api.submitTargetOpening).mock.calls[0]![1].submissionId,
  ).toBe(vi.mocked(api.submitTargetOpening).mock.calls[1]![1].submissionId)
  await click(wrapper, '取消')
  await click(wrapper, '新建')
  expect(wrapper.find('[aria-label="金额"]').exists()).toBe(false)
  wrapper.unmount()
})

it.each(['clear', 'remove'])(
  'releases pending product work after %s and ignores its late response',
  async (action) => {
    useTargetSession().apiPaths = [
      '/vou/purchase-order/submit-new',
      '/bob/product/get',
      '/vou/purchase-order/query',
    ]
    vi.mocked(api.queryTargetVouchers).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    vi.mocked(api.queryTargetVouOptions).mockImplementation(
      async (entity) =>
        ({
          items: [
            {
              entity: entity,
              objectId: entity === 'product' ? productId : referenceId,
              code: '01',
              name: entity === 'product' ? '包装桶' : '候选资料',
              approvalEntryId: entryId,
            },
          ],
        }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
    )
    vi.mocked(api.resolveTargetProduct).mockResolvedValue(
      productCurrent as Awaited<ReturnType<typeof api.resolveTargetProduct>>,
    )
    vi.mocked(api.submitTargetOrder).mockResolvedValue({
      documentId: referenceId,
    } as Awaited<ReturnType<typeof api.submitTargetOrder>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity: 'purchase-order' },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    await wrapper
      .get('[data-testid="document-editor"] [aria-label="供应商"]')
      .setValue(referenceId)
    await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
    await click(wrapper, '添加商品行')
    let resolveOld!: (
      value: Awaited<ReturnType<typeof api.resolveTargetProduct>>,
    ) => void
    vi.mocked(api.resolveTargetProduct).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    await wrapper.get('[aria-label="产品"]').setValue(productId)
    await flushPromises()
    if (action === 'clear')
      await wrapper.get('[aria-label="产品"]').setValue('')
    else {
      await click(wrapper, '移除商品行第 1 行')
      await click(wrapper, '添加商品行')
    }
    await wrapper.get('[aria-label="产品"]').setValue(productId)
    await flushPromises()
    resolveOld({ ...productCurrent, enabled: false } as Awaited<
      ReturnType<typeof api.resolveTargetProduct>
    >)

    await flushPromises()
    await wrapper.get('[aria-label="录入数量"]').setValue('2')
    await wrapper.get('[aria-label="基准数量"]').setValue('2')
    await wrapper.get('[aria-label="基础单价"]').setValue('15.00')
    await click(wrapper, '提交')
    expect(api.submitTargetOrder, wrapper.text()).toHaveBeenCalledTimes(1)
    const [, entity, input] = vi.mocked(api.submitTargetOrder).mock.calls[0]!
    expect(entity).toBe('purchase-order')
    expect(input.payload).toMatchObject({
      supplier: {
        objectId: referenceId,
        approvalEntryId: entryId,
        selectionOrigin: 'CURRENT',
      },
      warehouse: { objectId: referenceId },
      productLines: [
        {
          product: { objectId: productId },
          enteredQuantity: '2',
          baseQuantity: '2',
          unitPrice: '15.00',
          enteredUnit: { objectId: unitId, quantityScale: 0 },
        },
      ],
    })
    expect(input.documentId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(input.submissionId).not.toBe(input.documentId)
    expect(input.idempotencyKey).toBe(input.submissionId)
    expect(api.queryTargetVouchers).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('提交成功')
    wrapper.unmount()
  },
)

it.each(['RAW_MATERIAL', 'CUSTOM_FINISHED'] as const)(
  'clones ID-only order products through current options while preserving unresolved manual formulas (%s)',
  async (profile) => {
    useTargetSession().apiPaths = [
      '/vou/sale-order/query',
      '/vou/sale-order/get',
      '/vou/sale-order/submit-new',
      '/bob/product/get',
    ]
    const quantity = {
      enteredQuantity: '2',
      enteredUnit: {
        objectId: unitId,
        code: 'PC',
        name: '个',
        symbol: '个',
        quantityScale: 0,
      },
      baseQuantity: '2',
    }
    const payload = {
      businessDate: '2026-09-01',
      currency: 'CNY',
      remark: '复制备注',
      attachments: [],
      customerSubunit: {
        objectId: referenceId,
        approvalEntryId: entryId,
        selectionOrigin: 'CURRENT',
      },
      warehouse: { objectId: referenceId },
      operatingEntity: { objectId: referenceId },
      paymentMethod: null,
      productLines: [
        {
          lineId: referenceId,
          product: { objectId: productId },
          ...quantity,
          unitPrice: '10',
          settlementSurcharge: '3',
          quantityPerContainer: '8',
          deliverySpecificationType: 'PACKAGED',
          containerType: '',
          remark: '',
          formula: {
            sourceType: 'MANUAL',
            output: quantity,
            components: [{ material: { objectId: referenceId }, quantity }],
          },
        },
      ],
    }
    vi.mocked(api.queryTargetVouchers).mockResolvedValue({
      items: [
        {
          vouType: 'sale-order',
          documentId: referenceId,
          documentNo: 'SO01',
          revision: '1',
          businessDate: '2026-09-01',
          submittedDate: '2026-09-01',
          handlerName: null,
          counterpartyName: '客户',
          status: 'PENDING',
          amount: '20',
          currency: 'CNY',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    vi.mocked(api.getTargetVoucher).mockResolvedValue({
      entity: 'sale-order',
      documentId: referenceId,
      documentNo: 'SO01',
      revision: '1',
      submissionId: entryId,
      status: 'PENDING',
      availableApprovalActions: [],
      payload,
    } as Awaited<ReturnType<typeof api.getTargetVoucher>>)
    vi.mocked(api.resolveTargetProduct).mockResolvedValue({
      ...productCurrent,
      data: {
        ...productCurrent.data,
        productType: {
          ...productCurrent.data.productType,
          behaviorProfile: profile,
        },
      },
    } as Awaited<ReturnType<typeof api.resolveTargetProduct>>)
    vi.mocked(api.queryTargetBobOptions).mockResolvedValue(
      optionPage([
        {
          objectId: productId,
          sourceApprovalEntryId: entryId,
          code: 'R01',
          name: '当前原料',
        },
      ]) as Awaited<ReturnType<typeof api.queryTargetBobOptions>>,
    )
    vi.mocked(api.submitTargetOrder).mockResolvedValue({
      documentId: productId,
    } as Awaited<ReturnType<typeof api.submitTargetOrder>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity: 'sale-order' },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '打开')
    await click(wrapper, '复制到临时表单')
    await flushPromises()
    await click(wrapper, '提交')
    expect(api.resolveTargetProduct).toHaveBeenCalledWith(productId, entryId)
    if (profile === 'RAW_MATERIAL') {
      expect(api.submitTargetOrder).toHaveBeenCalled()
      const submitted = vi.mocked(api.submitTargetOrder).mock.calls[0]![2]
      expect(submitted.payload.productLines[0]).toMatchObject({
        enteredQuantity: '2',
        baseQuantity: '2',
        unitPrice: '10',
      })
    } else {
      expect(api.submitTargetOrder).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('配方原料尚未确认')
    }
    wrapper.unmount()
  },
)

it('submits purchase receipt with the selected exact source and refreshes once', async () => {
  useTargetSession().apiPaths = [
    '/vou/purchase-inbound/submit-new',
    '/vou/purchase-inbound/query',
    '/vou/source-line/query',
  ]
  vi.mocked(api.queryTargetVouchers).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.queryTargetVouOptions).mockImplementation(
    async (entity) =>
      ({
        items: [
          {
            entity: entity,
            objectId: referenceId,
            approvalEntryId: entryId,
            code: '01',
            name: '候选资料',
          },
        ],
      }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
  )
  vi.mocked(api.queryTargetVouSourceLines).mockResolvedValue({
    items: [
      {
        sourceDocumentId: referenceId,
        sourceDocumentNo: 'PO-20260909-0001',
        sourceEntity: 'purchase-order',
        rootEntity: 'purchase-order',
        rootDocumentId: referenceId,
        sourceLineId: 'source-line-1',
        businessDate: '2026-09-09',
        product: { objectId: productId, code: 'P01', name: '包装桶' },
        availableBaseQuantity: '5.000000',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.submitTargetVoucher).mockResolvedValue({
    documentId: referenceId,
  } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'purchase-inbound' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新建')
  await wrapper
    .get('[data-testid="document-editor"] [aria-label="供应商"]')
    .setValue(referenceId)
  await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
  await click(wrapper, '添加来源行')
  await wrapper
    .get('[aria-label="来源行"]')
    .setValue(`${referenceId}:source-line-1`)
  await flushPromises()
  await wrapper.get('[aria-label="基准数量"]').setValue('2.123456')
  await click(wrapper, '提交')
  expect(api.submitTargetVoucher, wrapper.text()).toHaveBeenCalledTimes(1)
  expect(
    vi.mocked(api.submitTargetVoucher).mock.calls[0]?.[2].payload,
  ).toMatchObject({
    parentEntity: 'purchase-order',
    parentDocumentId: referenceId,
    supplier: {
      objectId: referenceId,
      approvalEntryId: entryId,
      selectionOrigin: 'CURRENT',
    },
    warehouse: { objectId: referenceId },
    sourceLines: [{ sourceLineId: 'source-line-1', baseQuantity: '2.123456' }],
  })
  expect(api.queryTargetVouchers).toHaveBeenCalledTimes(2)
  wrapper.unmount()
})

it.each(['sale-return', 'purchase-return'] as const)(
  'requires a reason and exact source document when submitting %s',
  async (entity) => {
    useTargetSession().apiPaths = [
      `/vou/${entity}/submit-new`,
      '/vou/source-line/query',
    ]
    vi.mocked(api.queryTargetVouOptions).mockImplementation(
      async (entity) =>
        ({
          items: [
            {
              entity: entity,
              objectId: referenceId,
              approvalEntryId: entryId,
              code: '01',
              name: '候选资料',
            },
          ],
        }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
    )
    vi.mocked(api.queryTargetVouSourceLines).mockResolvedValue({
      items: [
        {
          sourceDocumentId: entryId,
          sourceDocumentNo: 'SOURCE-0001',
          sourceEntity:
            entity === 'sale-return' ? 'sale-signoff' : 'purchase-inbound',
          rootEntity:
            entity === 'sale-return' ? 'sale-order' : 'purchase-order',
          rootDocumentId: referenceId,
          sourceLineId: 'line-1',
          businessDate: '2026-09-09',
          product: { objectId: productId, code: 'P01', name: '包装桶' },
          availableBaseQuantity: '5.000000',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    if (entity === 'purchase-return')
      await wrapper.get('[aria-label="供应商"]').setValue(referenceId)
    await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
    await click(wrapper, '添加来源行')
    await wrapper.get('[aria-label="来源行"]').setValue(`${entryId}:line-1`)
    await wrapper.get('[aria-label="基准数量"]').setValue('1.000001')
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填写退货原因')
    await wrapper.get('[aria-label="退货原因"]').setValue('质量退货')
    await click(wrapper, '提交')
    expect(
      vi.mocked(api.submitTargetVoucher).mock.calls[0]?.[2].payload,
    ).toMatchObject({
      parentDocumentId: referenceId,
      returnReason: '质量退货',
      returnLines: [
        {
          sourceDocumentId: entryId,
          sourceLineId: 'line-1',
          baseQuantity: '1.000001',
        },
      ],
    })
    expect(wrapper.text()).toContain('提交成功')
    wrapper.unmount()
  },
)

it('clones return facts and exact sources without inheriting submission identity', async () => {
  const entity = 'purchase-return'
  useTargetSession().apiPaths = [
    `/vou/${entity}/query`,
    `/vou/${entity}/get`,
    `/vou/${entity}/attachment-read`,
    `/vou/${entity}/submit-new`,
  ]
  const payload = {
    businessDate: '2026-09-01',
    currency: 'CNY',
    remark: '复制备注',
    attachments: [
      {
        id: productId,
        fileName: '退货凭证.pdf',
        contentType: 'application/pdf',
        sizeBytes: 20,
        sha256: 'a'.repeat(64),
        stagingId: productId,
      },
    ],
    supplier: {
      objectId: referenceId,
      approvalEntryId: entryId,
      selectionOrigin: 'CURRENT',
    },
    warehouse: { objectId: referenceId },
    parentEntity: 'purchase-order',
    parentDocumentId: referenceId,
    returnReason: '质量退货',
    returnLines: [
      {
        sourceDocumentId: productId,
        sourceLineId: 'original-line',
        baseQuantity: '1.123456',
        remark: '保留备注',
      },
    ],
  }
  vi.mocked(api.queryTargetVouchers).mockResolvedValue({
    items: [
      {
        vouType: entity,
        documentId: referenceId,
        documentNo: 'PR01',
        revision: '1',
        businessDate: '2026-09-01',
        submittedDate: '2026-09-01',
        handlerName: null,
        counterpartyName: '供应商',
        status: 'PENDING',
        amount: '20',
        currency: 'CNY',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.getTargetVoucher).mockResolvedValue({
    entity,
    documentId: referenceId,
    documentNo: 'PR01',
    revision: '1',
    submissionId: entryId,
    status: 'PENDING',
    availableApprovalActions: [],
    payload,
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>)
  vi.mocked(api.submitTargetVoucher).mockResolvedValue({
    documentId: productId,
  } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '打开')
  expect(wrapper.get('.attachment-block').text()).toContain('退货凭证.pdf')
  expect(wrapper.get('.attachment-block').text()).toContain('下载附件')
  expect(wrapper.get('.attachment-block').text()).not.toContain('移除附件')
  await click(wrapper, '复制到临时表单')
  expect(wrapper.get('[data-testid="document-editor"]').text()).not.toContain(
    '退货凭证.pdf',
  )
  await click(wrapper, '提交')
  expect(api.submitTargetVoucher, wrapper.text()).toHaveBeenCalledTimes(1)
  const input = vi.mocked(api.submitTargetVoucher).mock.calls[0]![2]
  expect(input.documentId).not.toBe(referenceId)
  expect(input.submissionId).not.toBe(entryId)
  expect(input.payload).toMatchObject({
    ...payload,
    attachments: [],
    supplier: { ...payload.supplier, selectionOrigin: 'HISTORICAL' },
  })
  wrapper.unmount()
})

it.each(['purchase-inquiry', 'inventory-count', 'sale-pricing'] as const)(
  'submits %s through product candidates with decimal facts',
  async (entity) => {
    useTargetSession().apiPaths = [
      `/vou/${entity}/submit-new`,
      '/bob/product/get',
    ]
    vi.mocked(api.queryTargetVouOptions).mockImplementation(
      async (entity) =>
        ({
          items: [
            {
              entity: entity,
              objectId: entity === 'product' ? productId : referenceId,
              approvalEntryId: entryId,
              code: '01',
              name: '候选资料',
            },
          ],
        }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
    )
    vi.mocked(api.resolveTargetProduct).mockResolvedValue(
      productCurrent as Awaited<ReturnType<typeof api.resolveTargetProduct>>,
    )
    vi.mocked(api.submitTargetVoucher).mockResolvedValue({
      documentId: referenceId,
    } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    if (entity !== 'sale-pricing')
      await wrapper
        .get(
          `[aria-label="${entity === 'purchase-inquiry' ? '供应商' : '仓库'}"]`,
        )
        .setValue(referenceId)
    await click(wrapper, '添加商品行')
    await wrapper.get('[aria-label="产品"]').setValue(productId)
    await flushPromises()
    if (entity !== 'inventory-count')
      await wrapper.get('[aria-label="单价"]').setValue('12.34')
    else {
      await wrapper.get('[aria-label="实盘数量"]').setValue('0')
      await wrapper.get('[aria-label="基准数量"]').setValue('0')
    }
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher, wrapper.text()).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(api.submitTargetVoucher).mock.calls[0]![2].payload,
    ).toMatchObject(
      entity !== 'inventory-count'
        ? {
            priceLines: [
              {
                product: { objectId: productId, approvalEntryId: entryId },
                unitPrice: '12.34',
              },
            ],
          }
        : {
            inventoryCountLines: [
              {
                product: { objectId: productId },
                enteredQuantity: '0',
                baseQuantity: '0',
                enteredUnit: { objectId: unitId },
              },
            ],
          },
    )
    if (entity === 'inventory-count') {
      const payload = vi.mocked(api.submitTargetVoucher).mock.calls[0]![2]
        .payload
      expect(
        'inventoryCountLines' in payload &&
          payload.inventoryCountLines[0]!.enteredUnit,
      ).toEqual({ objectId: unitId })
    }
    wrapper.unmount()
  },
)

it('submits self production from a fixed formula and retains the reason for an adjusted material', async () => {
  useTargetSession().apiPaths = [
    '/vou/self-production/submit-new',
    '/bob/product/get',
  ]
  vi.mocked(api.queryTargetVouOptions).mockImplementation(
    async (entity) =>
      ({
        items: [
          {
            entity: entity,
            objectId: entity === 'product' ? productId : referenceId,
            approvalEntryId: entryId,
            code: '01',
            name: '候选资料',
          },
        ],
      }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
  )
  const quantity = {
    enteredQuantity: '1',
    enteredUnit: productCurrent.data.defaultInputUnit,
    baseQuantity: '1',
  }
  vi.mocked(api.resolveTargetProduct).mockResolvedValue({
    ...productCurrent,
    data: {
      ...productCurrent.data,
      productType: {
        ...productCurrent.data.productType,
        behaviorProfile: 'STANDARD_FINISHED',
      },
      fixedFormula: {
        output: quantity,
        components: [
          {
            material: {
              objectId: referenceId,
              approvalEntryId: entryId,
              code: 'R01',
              name: '原料',
            },
            quantity,
            resolutionStatus: 'CURRENT',
            requiresConfirmation: false,
          },
        ],
      },
    },
  } as Awaited<ReturnType<typeof api.resolveTargetProduct>>)
  vi.mocked(api.submitTargetVoucher).mockResolvedValue({
    documentId: referenceId,
  } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'self-production' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新建')
  await wrapper.get('[aria-label="材料仓库"]').setValue(referenceId)
  await wrapper.get('[aria-label="成品仓库"]').setValue(referenceId)
  await click(wrapper, '添加成品行')
  await wrapper.get('[aria-label="成品"]').setValue(productId)
  await flushPromises()
  await wrapper.get('[aria-label="成品数量"]').setValue('2')
  await wrapper.get('[aria-label="成品基准数量"]').setValue('2')
  await wrapper.get('[aria-label="实际基准领料量"]').setValue('1')
  await click(wrapper, '提交')
  expect(api.submitTargetVoucher).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('调整原因')
  await wrapper.get('[aria-label="调整原因"]').setValue('节约材料')
  await click(wrapper, '提交')
  expect(
    vi.mocked(api.submitTargetVoucher).mock.calls[0]?.[2].payload,
  ).toMatchObject({
    currency: '',
    productionLines: [
      {
        product: { objectId: productId },
        baseQuantity: '2',
        lossRate: '0',
        materials: [
          {
            formulaLineNo: 1,
            actualMaterial: { objectId: referenceId },
            actualBaseQuantity: '1',
            adjustmentReason: '节约材料',
          },
        ],
      },
    ],
  })
  wrapper.unmount()
})

it('adopts the exact order production source and immutable formula', async () => {
  useTargetSession().apiPaths = [
    '/vou/order-production/submit-new',
    '/vou/source-line/query',
    '/vou/sale-order/get',
  ]
  vi.mocked(api.queryTargetVouOptions).mockResolvedValue({
    items: [
      { entity: 'warehouse', objectId: referenceId, code: 'W01', name: '仓库' },
    ],
  })
  vi.mocked(api.queryTargetVouSourceLines).mockResolvedValue({
    items: [
      {
        sourceDocumentId: entryId,
        sourceDocumentNo: 'SO01',
        sourceEntity: 'sale-order',
        rootEntity: 'sale-order',
        rootDocumentId: entryId,
        sourceLineId: 'finished-line',
        businessDate: '2026-09-09',
        product: { objectId: productId, code: 'F01', name: '定制成品' },
        availableBaseQuantity: '5',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  const quantity = {
    enteredQuantity: '1',
    enteredUnit: {
      objectId: unitId,
      code: 'PC',
      name: '个',
      symbol: '个',
      quantityScale: 0,
    },
    baseQuantity: '1',
  }
  const sourceDocument = {
    entity: 'sale-order',
    status: 'APPROVED',
    payload: {
      productLines: [
        {
          lineId: 'finished-line',
          product: { objectId: productId },
          formula: {
            sourceType: 'MANUAL',
            output: quantity,
            components: [{ material: { objectId: referenceId }, quantity }],
          },
        },
      ],
    },
  }
  vi.mocked(api.resolveTargetSaleOrderLine).mockResolvedValue({
    documentId: entryId,
    documentNo: 'SO01',
    approvalEntryId: entryId,
    line: sourceDocument.payload.productLines[0],
  } as never)
  vi.mocked(api.submitTargetVoucher).mockResolvedValue({
    documentId: referenceId,
  } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'order-production' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新建')
  await wrapper.get('[aria-label="材料仓库"]').setValue(referenceId)
  await wrapper.get('[aria-label="成品仓库"]').setValue(referenceId)
  await click(wrapper, '添加成品行')
  await wrapper
    .get('[aria-label="来源行"]')
    .setValue(`${entryId}:finished-line`)
  await flushPromises()
  await click(wrapper, '提交')
  expect(
    vi.mocked(api.submitTargetVoucher).mock.calls[0]?.[2].payload,
  ).toMatchObject({
    parentEntity: 'sale-order',
    parentDocumentId: entryId,
    productionLines: [
      {
        sourceOrderLineId: 'finished-line',
        product: { objectId: productId },
        baseQuantity: '1',
        materials: [
          {
            actualMaterial: { objectId: referenceId },
            actualBaseQuantity: '1.000000',
          },
        ],
      },
    ],
  })
  wrapper.unmount()
})

it('adds a book-balance product as a candidate while requiring an explicit actual count', async () => {
  useTargetSession().apiPaths = [
    '/vou/inventory-count/submit-new',
    '/vou/inventory-count/book-balance',
    '/bob/product/get',
  ]
  vi.mocked(api.queryTargetVouOptions).mockResolvedValue({
    items: [
      { entity: 'warehouse', objectId: referenceId, code: 'W01', name: '仓库' },
    ],
  })
  vi.mocked(api.queryTargetInventoryBookBalance).mockResolvedValue({
    items: [
      {
        product: { objectId: productId, code: 'P01', name: '账面商品' },
        bookQuantity: '10.00000000',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.resolveTargetProduct).mockResolvedValue(
    productCurrent as Awaited<ReturnType<typeof api.resolveTargetProduct>>,
  )
  vi.mocked(api.queryTargetBobOptions).mockResolvedValue(
    optionPage([
      {
        objectId: productId,
        sourceApprovalEntryId: entryId,
        code: 'P01',
        name: '账面商品',
      },
    ]) as Awaited<ReturnType<typeof api.queryTargetBobOptions>>,
  )
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'inventory-count' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新建')
  await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
  await click(wrapper, '查看账面商品')
  useTargetSession().csrfToken = ''
  await click(wrapper, '加入盘点：账面商品')
  expect(api.queryTargetBobOptions).toHaveBeenCalledWith(
    'product',
    expect.objectContaining({ ids: [productId], enabled: 'true' }),
  )
  expect(api.resolveTargetProduct).toHaveBeenCalledWith(productId, entryId)
  expect(wrapper.get('[aria-label="实盘数量"]').element).toHaveProperty(
    'value',
    '',
  )
  useTargetSession().csrfToken = 'test-csrf'
  await click(wrapper, '提交')
  expect(api.submitTargetVoucher).not.toHaveBeenCalled()
  wrapper.unmount()
})

it.each([
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
  'other-income',
] as const)(
  'submits %s from money and expense candidates without losing decimal strings',
  async (entity) => {
    useTargetSession().apiPaths = [`/vou/${entity}/submit-new`]
    vi.mocked(api.queryTargetVouOptions).mockImplementation(
      async (entity) =>
        ({
          items: [
            {
              entity: entity,
              objectId: referenceId,
              approvalEntryId: entryId,
              code: '01',
              name: '可用资料',
              customerId: referenceId,
            },
          ],
        }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
    )
    vi.mocked(api.submitTargetVoucher).mockResolvedValue({
      documentId: productId,
    } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    const choose = async (caption: string) => {
      await wrapper.get(`[aria-label="${caption}"]`).setValue(referenceId)
      await flushPromises()
    }
    const expenses =
      entity === 'employee-loan-writeoff' || entity === 'expense-reimbursement'
    if (entity.startsWith('employee-') || expenses) await choose('员工')
    else if (entity === 'sales-receipt') {
      await choose('客户')
      await choose('经营主体')
      await click(wrapper, '添加分摊行')
      await choose('客户子单位')
      await wrapper.get('[aria-label="分摊金额"]').setValue('1234567890123.45')
    } else if (entity === 'sales-refund') await choose('客户子单位')
    else if (entity.startsWith('purchase-')) await choose('供应商')
    else if (entity === 'other-income')
      await wrapper.get('[aria-label="来源名称"]').setValue('其他业务收入')
    else await choose('相对方')
    if (expenses) {
      expect(wrapper.find('[aria-label="资金账户"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="经办人"]').exists()).toBe(false)
      await click(wrapper, '添加费用行')
      await wrapper.get('[aria-label="费用类别"]').setValue('差旅')
      await wrapper.get('[aria-label="费用说明"]').setValue('客户现场服务')
      await wrapper.get('[aria-label="费用金额"]').setValue('1234567890123.45')
    } else {
      await choose('资金账户')
      await choose('经办人')
      await wrapper.get('[aria-label="金额"]').setValue('1234567890123.45')
    }
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher, wrapper.text()).toHaveBeenCalledTimes(1)
    const [token, actualEntity, input] = vi.mocked(api.submitTargetVoucher).mock
      .calls[0]!
    expect(token).toBe('test-csrf')
    expect(actualEntity).toBe(entity)
    expect(input.expectedRevision).toBeNull()
    expect(input.payload).toMatchObject(
      expenses
        ? {
            expenseLines: [
              {
                category: '差旅',
                description: '客户现场服务',
                amount: '1234567890123.45',
              },
            ],
          }
        : {
            amount: '1234567890123.45',
            fundAccount: { objectId: referenceId },
            handler: { objectId: referenceId },
          },
    )
    expect(wrapper.text()).toContain('提交成功')
    wrapper.unmount()
  },
)

it.each(['supplier', 'employee', 'other-unit', 'sales-partner'] as const)(
  'changes other-payment candidates to %s before adopting the new counterparty',
  async (party) => {
    useTargetSession().apiPaths = ['/vou/other-payment/submit-new']
    vi.mocked(api.queryTargetVouOptions).mockImplementation(
      async (entity) =>
        ({
          items: [
            {
              entity: entity,
              objectId: referenceId,
              approvalEntryId: entryId,
              code: '01',
              name: '候选',
            },
          ],
        }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
    )
    vi.mocked(api.submitTargetVoucher).mockResolvedValue({
      documentId: productId,
    } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity: 'other-payment' },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    await wrapper.get('[aria-label="相对方类型"]').setValue(party)
    await flushPromises()
    expect(api.queryTargetVouOptions).toHaveBeenCalledWith(
      party,
      expect.objectContaining({ page: '1', pageSize: '20' }),
    )
    for (const caption of ['相对方', '资金账户', '经办人'])
      await wrapper.get(`[aria-label="${caption}"]`).setValue(referenceId)
    await wrapper.get('[aria-label="金额"]').setValue('0.00')
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher, wrapper.text()).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(api.submitTargetVoucher).mock.calls[0]![2].payload,
    ).toMatchObject({
      counterpartyType: party,
      amount: '0.00',
      counterparty:
        party === 'employee'
          ? { objectId: referenceId }
          : {
              objectId: referenceId,
              approvalEntryId: entryId,
              selectionOrigin: 'CURRENT',
            },
    })
    wrapper.unmount()
  },
)

it.each(['asset-acquisition', 'asset-sale', 'asset-liquidation'] as const)(
  'submits %s from asset and category candidates',
  async (entity) => {
    useTargetSession().apiPaths = [`/vou/${entity}/submit-new`]
    vi.mocked(api.queryTargetVouOptions).mockImplementation(
      async (entity) =>
        ({
          items: [
            {
              entity: entity,
              objectId: referenceId,
              approvalEntryId: entryId,
              code: '01',
              name: '资产资料',
              defaultUsefulLifeMonths: 24,
              defaultResidualRate: '5.00',
            },
          ],
        }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
    )
    vi.mocked(api.submitTargetVoucher).mockResolvedValue({
      documentId: productId,
    } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    const choose = async (caption: string) => {
      await wrapper.get(`[aria-label="${caption}"]`).setValue(referenceId)
      await flushPromises()
    }
    if (entity === 'asset-acquisition') await choose('供应商')
    if (entity === 'asset-sale') await choose('相对方')
    await click(wrapper, '添加资产行')
    if (entity === 'asset-acquisition') {
      await wrapper.get('[aria-label="资产名称"]').setValue('打印设备')
      await choose('资产类别')
      await choose('使用部门')
      expect(wrapper.get('[aria-label="使用月数"]').element).toHaveProperty(
        'value',
        '24',
      )
      expect(wrapper.get('[aria-label="残值率"]').element).toHaveProperty(
        'value',
        '5.00',
      )
      await wrapper.get('[aria-label="原值"]').setValue('10000.01')
      await wrapper.get('[aria-label="使用月数"]').setValue('36')
    } else {
      await choose('在用资产')
      if (entity === 'asset-sale')
        await wrapper.get('[aria-label="出让金额"]').setValue('10000.01')
      else {
        await wrapper.get('[aria-label="清理原因"]').setValue('使用寿命结束')
        await wrapper.get('[aria-label="残值收入"]').setValue('100.01')
        await wrapper.get('[aria-label="处置费用"]').setValue('0.01')
      }
    }
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher, wrapper.text()).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(api.submitTargetVoucher).mock.calls[0]![2].payload
    expect(payload).toMatchObject(
      entity === 'asset-acquisition'
        ? {
            assetAcquisitionLines: [
              {
                assetName: '打印设备',
                originalValue: '10000.01',
                usefulLifeMonths: 36,
                residualRate: '5.00',
                category: {
                  objectId: referenceId,
                  defaultUsefulLifeMonths: 24,
                  defaultResidualRate: '5.00',
                },
              },
            ],
          }
        : entity === 'asset-sale'
          ? {
              assetSaleLines: [
                { assetId: referenceId, saleAmount: '10000.01' },
              ],
            }
          : {
              assetLiquidationLines: [
                {
                  assetId: referenceId,
                  reason: '使用寿命结束',
                  salvageIncome: '100.01',
                  disposalExpense: '0.01',
                },
              ],
            },
    )
    wrapper.unmount()
  },
)

it.each([
  'bill-receipt',
  'bill-payment',
  'bill-issue',
  'bill-discount',
  'bill-maturity',
] as const)(
  'submits %s through finite bill and cash fields',
  async (entity) => {
    useTargetSession().apiPaths = [`/vou/${entity}/submit-new`]
    vi.mocked(api.queryTargetVouOptions).mockImplementation(
      async (entity) =>
        ({
          items: [
            {
              entity: entity,
              objectId: referenceId,
              approvalEntryId: entryId,
              code: '01',
              name: '票据候选',
            },
          ],
        }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
    )
    vi.mocked(api.submitTargetVoucher).mockResolvedValue({
      documentId: productId,
    } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    const choose = async (caption: string) => {
      await wrapper.get(`[aria-label="${caption}"]`).setValue(referenceId)
      await flushPromises()
    }
    if (entity === 'bill-receipt') {
      await choose('客户子单位')
      await choose('经办人')
    }
    if (entity === 'bill-payment') {
      await choose('供应商')
      await choose('经办人')
    }
    if (entity === 'bill-issue') await choose('供应商')
    if (entity === 'bill-discount') await choose('贴现相对方')
    await click(wrapper, '添加票据行')
    if (entity === 'bill-receipt' || entity === 'bill-issue') {
      await wrapper.get('[aria-label="票据号码"]').setValue('TEST-00001')
      await wrapper.get('[aria-label="票面金额"]').setValue('10000.01')
      await wrapper.get('[aria-label="出票日期"]').setValue('2026-09-01')
      await wrapper.get('[aria-label="到期日期"]').setValue('2027-03-01')
      for (const label of ['出票人', '承兑人', '收款人'])
        await wrapper.get(`[aria-label="${label}"]`).setValue('测试单位')
    } else await choose('可用票据')
    await click(wrapper, '添加现金行')
    await choose('现金资金账户')
    await wrapper.get('[aria-label="现金金额"]').setValue('9999.99')
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher, wrapper.text()).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(api.submitTargetVoucher).mock.calls[0]![2].payload
    if (entity === 'bill-receipt') {
      expect(payload).toHaveProperty('customerSubunit.objectId', referenceId)
      expect(payload).not.toHaveProperty('customer')
    }
    expect(payload).toMatchObject({
      billLines: [
        entity === 'bill-receipt' || entity === 'bill-issue'
          ? {
              billNo: 'TEST-00001',
              faceAmount: '10000.01',
              positionType: entity === 'bill-receipt' ? 'ASSET' : 'LIABILITY',
              purpose: 'PRIMARY',
            }
          : { billId: referenceId, purpose: 'PRIMARY' },
      ],
      billCashLines: [
        { fundAccount: { objectId: referenceId }, amount: '9999.99' },
      ],
    })
    wrapper.unmount()
  },
)

it.each(['service-contract', 'service-acceptance'] as const)(
  'submits %s through selected service references and typed facts',
  async (entity) => {
    useTargetSession().apiPaths = [`/vou/${entity}/submit-new`]
    vi.mocked(api.queryTargetVouOptions).mockImplementation(
      async (entity) =>
        ({
          items: [
            {
              entity: entity,
              objectId: referenceId,
              approvalEntryId: entryId,
              code: '01',
              name: '服务候选',
            },
          ],
        }) as Awaited<ReturnType<typeof api.queryTargetVouOptions>>,
    )
    vi.mocked(api.submitTargetVoucher).mockResolvedValue({
      documentId: referenceId,
    } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    await wrapper.get('[aria-label="经办员工"]').setValue(referenceId)
    if (entity === 'service-contract') {
      await wrapper.get('[aria-label="相对方"]').setValue(referenceId)
      await wrapper.get('[aria-label="合同条款"]').setValue('按合同交付')
      await wrapper.get('[aria-label="相对方类型"]').setValue('sales-partner')
      await click(wrapper, '提交')
      expect(api.submitTargetVoucher).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('请选择合同相对方。')
      await wrapper.get('[aria-label="相对方类型"]').setValue('other-unit')
    } else {
      await wrapper.get('[aria-label="服务合同"]').setValue(referenceId)
      await wrapper.get('[aria-label="结算金额"]').setValue('12.34')
      await wrapper.get('[aria-label="履约事实"]').setValue('已交付')
      await wrapper.get('[aria-label="验收事实"]').setValue('合格')
    }
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher, wrapper.text()).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(api.submitTargetVoucher).mock.calls[0]![2].payload,
    ).toMatchObject(
      entity === 'service-contract'
        ? {
            counterparty: { objectId: referenceId, approvalEntryId: entryId },
            serviceContract: { terms: '按合同交付' },
          }
        : {
            amount: '12.34',
            serviceAcceptance: {
              contractDocumentId: referenceId,
              fulfillmentFact: '已交付',
              acceptanceFact: '合格',
              settlementDirection: 'PAYABLE',
            },
          },
    )
    wrapper.unmount()
  },
)

it.each([null, 'network', 'internal_error', 'invalid_response'])(
  'maintains a persisted intermediary script and verifies an unknown save (%s) before recalculation',
  async (unknownSave) => {
    useTargetSession().apiPaths = [
      'submit-new',
      'script-get',
      'script-save',
      'source',
    ].map((action) => `/vou/intermediary-calculation/${action}`)
    const source = {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      currency: 'CNY' as const,
      lines: [],
      bills: [],
    }
    let script = {
      scriptId: 'GLOBAL',
      revision: 1,
      name: '月度脚本',
      source: 'globalThis.calculate = () => ({lines:[], summaries:[]})',
      hash: 'a'.repeat(64),
    }
    vi.mocked(api.getTargetIntermediaryScript).mockResolvedValue(null)
    vi.mocked(api.getTargetIntermediarySource).mockResolvedValue({
      source,
      sourceHash: 'b'.repeat(64),
    })
    vi.mocked(api.saveTargetIntermediaryScript).mockResolvedValue(script)
    vi.mocked(api.submitTargetVoucher).mockResolvedValue({
      documentId: referenceId,
    } as Awaited<ReturnType<typeof api.submitTargetVoucher>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity: 'intermediary-calculation' },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    await wrapper.get('[aria-label="计算月末日期"]').setValue('2026-09-30')
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher).not.toHaveBeenCalled()
    await wrapper.get('[aria-label="脚本名称"]').setValue(script.name)
    await wrapper.get('[aria-label="计算脚本"]').setValue(script.source)
    await click(wrapper, '试运行脚本')
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('当前脚本试运行成功'),
    )
    if (unknownSave)
      vi.mocked(api.saveTargetIntermediaryScript).mockRejectedValueOnce(
        unknownSave === 'network'
          ? new Error('network timeout')
          : new api.TargetApiError(unknownSave!, '', 'script-request'),
      )
    await click(wrapper, '保存计算脚本')
    if (unknownSave) {
      await click(wrapper, '取消')
      expect(wrapper.text()).toContain('脚本保存结果未知')
      const createButton = wrapper
        .findAll('button')
        .find((button) => button.text() === '新建')!
      expect(createButton.attributes('disabled')).toBeDefined()
      await click(wrapper, '核实脚本保存')
      expect(api.saveTargetIntermediaryScript).toHaveBeenCalledTimes(1)
      expect(createButton.attributes('disabled')).toBeDefined()
      vi.mocked(api.getTargetIntermediaryScript).mockResolvedValue(script)
      await click(wrapper, '核实脚本保存')
      await click(wrapper, '新建')
      await wrapper.get('[aria-label="计算月末日期"]').setValue('2026-09-30')
      expect(
        wrapper.get('[aria-label="计算脚本"]').attributes('disabled'),
      ).toBeUndefined()
    }
    expect(api.saveTargetIntermediaryScript).toHaveBeenCalledWith('test-csrf', {
      name: script.name,
      source: script.source,
      expectedRevision: null,
    })
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher).not.toHaveBeenCalled()
    vi.mocked(api.getTargetIntermediaryScript).mockResolvedValue(script)
    await click(wrapper, '重新计算')
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('采用脚本：月度脚本'),
    )
    if (unknownSave) {
      const nextScript = {
        ...script,
        revision: 2,
        source: script.source + '\n// next revision',
      }
      await wrapper.get('[aria-label="计算脚本"]').setValue(nextScript.source)
      await click(wrapper, '试运行脚本')
      await vi.waitFor(() =>
        expect(wrapper.text()).toContain('当前脚本试运行成功'),
      )
      vi.mocked(api.saveTargetIntermediaryScript).mockRejectedValueOnce(
        new Error('lost response'),
      )
      await click(wrapper, '保存计算脚本')
      vi.mocked(api.getTargetIntermediaryScript).mockResolvedValue(nextScript)
      await click(wrapper, '核实脚本保存')
      expect(wrapper.find('[aria-label="计算结果"]').exists()).toBe(false)
      await click(wrapper, '提交')
      expect(api.submitTargetVoucher).not.toHaveBeenCalled()
      await click(wrapper, '重新计算')
      await vi.waitFor(() =>
        expect(wrapper.find('[aria-label="计算结果"]').exists()).toBe(true),
      )
      script = nextScript
    }
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(api.submitTargetVoucher).mock.calls[0]![2].payload,
    ).toMatchObject({
      businessDate: '2026-09-30',
      intermediaryCalculation: {
        source,
        sourceHash: 'b'.repeat(64),
        script,
        result: { lines: [], summaries: [] },
      },
    })
    wrapper.unmount()
  },
)

function optionPage(items: readonly object[]) {
  return {
    items: items.map((item) => ({ enabled: true, ...item })),
    total: items.length,
    page: 1,
    pageSize: 20,
  }
}
